"""
Full PDF-to-Markdown pipeline orchestrator.

Coordinates all stages: text extraction → formula extraction → segmentation →
metadata rules → LLM annotation → merge → review → final markdown.

Supports both synchronous (run) and streaming (run_streaming) modes.

Text/span alignment: the pipeline uses spans as the SINGLE SOURCE OF TRUTH
for text layout. Text is reconstructed via spans_to_text() so that all
position-based operations stay aligned. NEVER use parse_pdf() text with
span offsets.
"""

from __future__ import annotations

import logging
import os
import time
from pathlib import Path
from typing import AsyncGenerator

from .annotation_schema import SSEMessage, StructuralLabel, LabeledSpan, SentenceAnnotation
from .span_extractor import extract_spans, spans_to_text
from .text_segmenter import segment_text, get_sentence_count
from .metadata_rules import apply_metadata_rules
from .formula_extractor import extract_formulas
from .llm_annotator import annotate_document
from .merge_engine import merge_annotations
from .review_layer import check_annotation_rules, llm_review_violations
from .streaming import (
    pipeline_start,
    ocr_progress,
    formula_progress,
    annotation_progress,
    sentence_result,
    review_issue,
    pipeline_complete,
    pipeline_error,
)

logger = logging.getLogger(__name__)


class FullPipeline:
    """Orchestrates the complete PDF-to-Markdown pipeline."""

    def __init__(self, file_path: str, max_pages: int = 0):
        """Args:
            file_path: Path to the PDF file.
            max_pages: If >0, only process the first N pages (for fast testing).
        """
        self.file_path = file_path
        self.max_pages = max_pages
        self.text: str = ""
        self.spans: list = []
        self.formulas: list[LabeledSpan] = []
        self.metadata_markers: dict = {}
        self.segments: list = []
        self.llm_annotations: list = []
        self.markdown: str = ""
        self.violations: list = []

    def run(self) -> str:
        """Run the full pipeline synchronously. Returns final Markdown."""
        # Stage 1+2: Extract text and spans in a single pass, check OCR need
        needs_ocr = self._extract_and_check()

        if not self.text.strip():
            logger.warning("Empty text extracted from PDF")
            return ""

        # Stage 3: Formula extraction
        if not needs_ocr and self.spans:
            try:
                self.formulas = extract_formulas(self.file_path, self.spans)
                logger.info(f"Extracted {len(self.formulas)} formula regions")
            except Exception as e:
                logger.warning(f"Formula extraction failed (non-fatal): {e}")
                self.formulas = []

        # Stage 4: Metadata rules (bold/italic/mono)
        if self.spans:
            self.metadata_markers = apply_metadata_rules(self.spans)
            # Suppress italic markers in math-heavy documents
            self._suppress_formatting_if_math_heavy()

        # Stage 5: Segment text
        span_page_map = {}
        for span in self.spans:
            span_page_map[span.char_start] = span.page_number

        self.segments = segment_text(self.text, span_page_map)
        total_sentences = len(self.segments)
        logger.info(f"Segmented into {total_sentences} sentences")

        if total_sentences == 0:
            return self.text

        # Stage 6: LLM annotation
        try:
            self.llm_annotations = annotate_document(self.segments, self.text)
            logger.info(f"LLM annotation produced {len(self.llm_annotations)} sentence annotations")
        except Exception as e:
            logger.error(f"LLM annotation failed: {e}")
            return self.text

        # Stage 7: Merge
        self.markdown = merge_annotations(
            self.text,
            self.metadata_markers,
            self.llm_annotations,
            self.formulas,
        )

        # Stage 8: Review
        self.violations = check_annotation_rules(self.llm_annotations, self.text)
        if self.violations:
            errors = [v for v in self.violations if v.severity == "error"]
            warnings = [v for v in self.violations if v.severity == "warning"]
            logger.info(f"Review: {len(errors)} errors, {len(warnings)} warnings")

            if errors:
                self.llm_annotations = llm_review_violations(
                    self.violations,
                    self.text,
                    self.llm_annotations,
                )
                # Re-merge with corrected annotations
                self.markdown = merge_annotations(
                    self.text,
                    self.metadata_markers,
                    self.llm_annotations,
                    self.formulas,
                )

        return self.markdown

    async def run_streaming(self) -> AsyncGenerator[SSEMessage, None]:
        """Run the pipeline with SSE streaming for each stage and sentence."""
        from .streaming import stage_progress

        t_start = time.time()
        t_stage_start = t_start
        t_prev_stage = 0.0

        def _progress(stage: str, detail: str = "", percent: int = 0) -> SSEMessage:
            nonlocal t_stage_start, t_prev_stage
            now = time.time()
            stage_ms = int((now - t_stage_start) * 1000)
            total_ms = int((now - t_start) * 1000)
            t_stage_start = now
            return stage_progress(stage, detail, percent, stage_ms, total_ms)

        file_name = os.path.basename(self.file_path)

        # Stage 1+2: Extract text and spans, check OCR
        yield _progress("extract", "Extracting text and spans from PDF...", 5)
        needs_ocr = self._extract_and_check()

        if not self.text.strip():
            yield pipeline_error("extract", "Empty text extracted from PDF", False)
            return

        if needs_ocr:
            yield _progress("ocr", "OCR text extraction used", 10)
        else:
            yield _progress("spans", f"Extracted {len(self.spans)} spans", 10)

        # Emit pipeline_start with actual stats
        full_page_count = self._get_page_count()
        actual_pages = max(s.page_number for s in self.spans) + 1 if self.spans else full_page_count
        yield pipeline_start(file_name, actual_pages, len(self.text))

        # Stage 3: Formula extraction
        if not needs_ocr and self.spans:
            yield _progress("formula", "Detecting math regions...", 20)
            try:
                self.formulas = extract_formulas(self.file_path, self.spans)
                review_needed_count = sum(1 for f in self.formulas if f.confidence < 0.7)
                yield formula_progress(len(self.formulas), review_needed_count)
                yield _progress("formula", f"Found {len(self.formulas)} math regions", 25)
            except Exception as e:
                yield pipeline_error("formula", str(e), recoverable=True)
                self.formulas = []
        else:
            yield _progress("formula", "Skipping formula extraction (OCR path)", 25)

        # Stage 4: Metadata rules
        yield _progress("metadata", "Applying font metadata rules...", 28)
        if self.spans:
            self.metadata_markers = apply_metadata_rules(self.spans)
            # Suppress italic markers in math-heavy documents
            self._suppress_formatting_if_math_heavy()

        # Stage 5: Segmentation
        yield _progress("segment", "Splitting text into sentences...", 30)
        span_page_map = {}
        for span in self.spans:
            span_page_map[span.char_start] = span.page_number

        self.segments = segment_text(self.text, span_page_map)
        total_sentences = len(self.segments)

        if total_sentences == 0:
            yield pipeline_complete(0, 0, 0, 0)
            return

        yield _progress("segment", f"Split into {total_sentences} sentences", 32)

        # Stage 6: LLM annotation with deduplication
        from .text_segmenter import chunk_segments
        from .llm_annotator import annotate_chunk

        chunks = chunk_segments(self.segments, chunk_size=20, overlap=2)
        # Use dict-based dedup instead of extend — prevents 7x repetition
        annotation_dict: dict[int, SentenceAnnotation] = {}
        total_chunks = len(chunks)

        yield _progress("annotate", f"Annotating structure with LLM ({total_chunks} chunks)...", 35)

        for chunk_idx, chunk in enumerate(chunks):
            yield annotation_progress(
                sum(len(c) for c in chunks[:chunk_idx]),
                total_sentences,
            )
            yield _progress(
                "annotate",
                f"LLM chunk {chunk_idx + 1}/{total_chunks} ({len(chunk)} sentences)...",
                35 + int((chunk_idx / max(total_chunks, 1)) * 40),
            )

            try:
                chunk_annotations = annotate_chunk(chunk, self.text)
            except Exception as e:
                logger.error(f"Chunk {chunk_idx} annotation failed: {e}")
                yield pipeline_error(
                    "annotation",
                    f"LLM annotation failed for chunk {chunk_idx + 1}/{total_chunks}: {e}",
                    recoverable=False,
                )
                return

            # Log label distribution for debugging
            label_counts: dict[str, int] = {}
            for sa in chunk_annotations:
                for ls in sa.labels:
                    label_counts[ls.label.value] = label_counts.get(ls.label.value, 0) + 1
            logger.info(f"Chunk {chunk_idx} LLM labels: {label_counts}")

            # Deduplicate: keep annotation with highest avg confidence per sentence_id
            for sent_ann in chunk_annotations:
                sid = sent_ann.sentence_id
                if sid not in annotation_dict:
                    annotation_dict[sid] = sent_ann
                else:
                    new_avg = sum(l.confidence for l in sent_ann.labels) / max(len(sent_ann.labels), 1)
                    existing_avg = sum(l.confidence for l in annotation_dict[sid].labels) / max(len(annotation_dict[sid].labels), 1)
                    if new_avg > existing_avg:
                        annotation_dict[sid] = sent_ann

            yield _progress("annotate", f"Chunk {chunk_idx + 1}/{total_chunks} done",
                           35 + int(((chunk_idx + 1) / max(total_chunks, 1)) * 40))

            # Yield per-sentence fragments for SSE streaming
            for sent_ann in chunk_annotations:
                sent_text = self.text[sent_ann.char_start:sent_ann.char_end]
                labels_json = [
                    {
                        "label": ls.label.value,
                        "char_start": ls.char_start,
                        "char_end": ls.char_end,
                        "nesting_level": ls.nesting_level,
                        "confidence": ls.confidence,
                    }
                    for ls in sent_ann.labels
                ]

                # Compute per-sentence fragment (NOT full-document merge)
                fragment = self._compute_sentence_fragment(sent_ann)

                yield sentence_result(
                    sent_ann.sentence_id,
                    fragment,
                    sent_text,
                    labels_json,
                )

            yield annotation_progress(
                sum(len(c) for c in chunks[:chunk_idx + 1]),
                total_sentences,
            )

        # Convert deduplicated dict to sorted list
        self.llm_annotations = [annotation_dict[sid] for sid in sorted(annotation_dict.keys())]

        # Stage 7: Full merge
        yield _progress("merge", "Merging annotations into Markdown...", 88)
        self.markdown = merge_annotations(
            self.text,
            self.metadata_markers,
            self.llm_annotations,
            self.formulas,
        )

        # Stage 8: Review
        yield _progress("review", "Checking annotation rules...", 93)
        self.violations = check_annotation_rules(self.llm_annotations, self.text)
        errors = [v for v in self.violations if v.severity == "error"]
        warnings = [v for v in self.violations if v.severity == "warning"]

        for v in self.violations:
            yield review_issue(v.region, v.rule_name, "detected")

        if errors:
            self.llm_annotations = llm_review_violations(
                self.violations, self.text, self.llm_annotations
            )
            self.markdown = merge_annotations(
                self.text, self.metadata_markers,
                self.llm_annotations, self.formulas,
            )
            for v in errors:
                yield review_issue(v.region, v.rule_name, "auto_fixed")

        unresolved = len(errors)
        yield pipeline_complete(
            total_markdown_length=len(self.markdown),
            issues_found=len(self.violations),
            issues_resolved=len(errors),
            unresolved=unresolved,
            final_markdown=self.markdown,
        )

    def _extract_and_check(self) -> bool:
        """Extract spans-based text and check OCR need in a single pass.

        Uses spans as the single source of truth for text. Text is
        reconstructed via spans_to_text() to maintain position alignment.
        Returns needs_ocr flag.
        """
        # Try span extraction first (single PDF open)
        try:
            all_spans = extract_spans(self.file_path)
            filtered_spans = self._filter_spans(all_spans)
            if filtered_spans:
                self.text = spans_to_text(filtered_spans)
                self.spans = filtered_spans
            else:
                self.text = ""
                self.spans = []
        except Exception as e:
            logger.warning(f"Span extraction failed: {e}")
            self.text = ""
            self.spans = []

        # Check OCR need from extracted data (no additional PDF open)
        needs_ocr = False
        if not self.text.strip():
            needs_ocr = True
        else:
            from file_parser import is_text_garbled
            if is_text_garbled(self.text):
                needs_ocr = True
            elif self.spans:
                page_count = max(s.page_number for s in self.spans) + 1
                avg_chars = len(self.text.strip()) / max(page_count, 1)
                if avg_chars < 50:
                    needs_ocr = True

        if needs_ocr:
            from pdf_ocr import ocr_pdf
            logger.info("PDF needs OCR, falling back to OCR extraction")
            text = ocr_pdf(self.file_path)
            if text and text.strip():
                # Apply sanitization to OCR text too
                from file_parser import sanitize_control_chars, _clean_pdf_text
                text = _clean_pdf_text(text)
                self.text = text
            else:
                self.text = ""
            self.spans = []  # no spans available for OCR text

        return needs_ocr

    def _get_page_count(self) -> int:
        """Get the number of pages in the PDF."""
        from pdf_ocr import get_page_count
        return get_page_count(self.file_path)

    def _filter_spans(self, spans: list) -> list:
        """Keep only spans from pages < max_pages. Returns all if max_pages is 0."""
        if self.max_pages <= 0:
            return spans
        return [s for s in spans if s.page_number < self.max_pages]

    def _find_formula_latex(self, start: int, end: int) -> str | None:
        """Look up OCR LaTeX for a formula region within [start, end)."""
        for f in self.formulas:
            if start <= f.char_start < end and f.latex_text:
                return f.latex_text
        return None

    def _inject_inline_math(self, text: str, abs_start: int, abs_end: int) -> str:
        """Inject $...$ markers around inline math regions within a text range.

        Used by _compute_sentence_fragment for SSE streaming. Analogous to
        merge_engine's _apply_inline_math_to_block but operates on a
        sentence-level range.
        """
        from .merge_engine import _sanitize_for_katex, _clean_unicode_math

        # Find inline MATH formula spans that fall within this sentence range
        math_regions = []
        for f in self.formulas:
            if f.label == StructuralLabel.MATH and abs_start <= f.char_start and f.char_end <= abs_end:
                math_regions.append((f.char_start, f.char_end, f.latex_text))

        if not math_regions:
            return text

        # Sort and inject $...$ markers (build from end to avoid offset shifts)
        math_regions.sort(key=lambda x: x[0])
        result_parts: list[str] = []
        prev_rel = 0  # relative position within text

        for m_start, m_end, latex in math_regions:
            # Convert absolute positions to relative within text
            rel_start = m_start - abs_start
            rel_end = m_end - abs_start
            if rel_start < 0 or rel_end > len(text):
                continue
            if rel_start > prev_rel:
                result_parts.append(text[prev_rel:rel_start])
            if latex:
                result_parts.append(f"${_sanitize_for_katex(latex)}$")
            else:
                raw = text[rel_start:rel_end]
                result_parts.append(f"${_sanitize_for_katex(_clean_unicode_math(raw))}$")
            prev_rel = rel_end

        if prev_rel < len(text):
            result_parts.append(text[prev_rel:])

        return "".join(result_parts)

    def _suppress_formatting_if_math_heavy(self) -> None:
        """Remove italic markers around single math symbols (Ω, σ, F, etc).

        In math PDFs, italic on single-letter variables is typesetting convention,
        not emphasis. But italic on multi-word phrases like "measurable event"
        IS semantic emphasis — preserve those.

        Only suppress italic when the marked text is a short math-like span
        (single char, or a few chars with high math density). Bold is always
        preserved since bold in math PDFs is rare and meaningful when present.
        """
        if not self.text or not self.metadata_markers:
            return

        from .formula_extractor import math_symbol_density
        text_density = math_symbol_density(self.text)
        if text_density < 0.01:
            return  # Not a math-heavy document

        from .annotation_schema import MarkerType
        removed = 0
        for pos in list(self.metadata_markers.keys()):
            original = self.metadata_markers[pos]
            filtered = []
            for m in original:
                # Only suppress ITALIC, never suppress BOLD
                if m.type in (MarkerType.ITALIC_OPEN, MarkerType.ITALIC_CLOSE):
                    # Check what text this italic wraps — get the span text at this position
                    span_text = ""
                    for s in self.spans:
                        if s.char_start <= pos <= s.char_end:
                            span_text = s.text
                            break
                    # Suppress italic only if text is short and math-like
                    if len(span_text.strip()) <= 2 or math_symbol_density(span_text) >= 0.5:
                        removed += 1
                        continue  # suppress this italic marker
                filtered.append(m)
            if filtered:
                self.metadata_markers[pos] = filtered
            else:
                del self.metadata_markers[pos]

        logger.info(
            f"Math-heavy document detected (density={text_density:.3f}), "
            f"removed {removed} italic markers"
        )

    def _compute_sentence_fragment(self, sent_ann: SentenceAnnotation) -> str:
        """Compute a per-sentence markdown fragment for SSE streaming.

        Produces just the sentence's text formatted according to its labels
        and inline markers, without calling merge_annotations() on the full
        document text.
        """
        from .annotation_schema import HEADING_LABELS, HEADING_LEVEL, MarkerType
        from .merge_engine import _already_has_list_marker, _hard_breaks, _sanitize_for_katex, _clean_unicode_math, _fix_math_operator_spacing

        sent_text = self.text[sent_ann.char_start:sent_ann.char_end]

        # Apply inline markers within the sentence range
        inline_result: list[str] = []
        markers_at_pos: list[tuple[int, MarkerType]] = []
        primary_label = sent_ann.labels[0].label if sent_ann.labels else StructuralLabel.PARAGRAPH

        for pos, marker_list in self.metadata_markers.items():
            if sent_ann.char_start <= pos <= sent_ann.char_end:
                rel_pos = pos - sent_ann.char_start
                for m in marker_list:
                    if primary_label in (StructuralLabel.MATH, StructuralLabel.DISPLAY_MATH):
                        if m.type in (MarkerType.ITALIC_OPEN, MarkerType.ITALIC_CLOSE):
                            continue
                    if primary_label in HEADING_LABELS:
                        if m.type in (MarkerType.BOLD_OPEN, MarkerType.BOLD_CLOSE,
                                       MarkerType.ITALIC_OPEN, MarkerType.ITALIC_CLOSE):
                            continue
                    markers_at_pos.append((rel_pos, m.type))

        markers_at_pos.sort(key=lambda x: (x[0], 0 if x[1].value.endswith("_open") else 1))

        prev = 0
        for rel_pos, marker_type in markers_at_pos:
            if rel_pos > prev:
                inline_result.append(sent_text[prev:rel_pos])
            prev = rel_pos
            marker_text = {
                MarkerType.BOLD_OPEN: "**", MarkerType.BOLD_CLOSE: "**",
                MarkerType.ITALIC_OPEN: "*", MarkerType.ITALIC_CLOSE: "*",
                MarkerType.MONO_OPEN: "`", MarkerType.MONO_CLOSE: "`",
            }.get(marker_type, "")
            inline_result.append(marker_text)
        inline_result.append(sent_text[prev:])
        inline_text = "".join(inline_result)

        nesting = sent_ann.labels[0].nesting_level if sent_ann.labels else 0

        if primary_label in HEADING_LABELS:
            level = HEADING_LEVEL.get(primary_label, 1)
            return f"\n\n{'#' * level} {inline_text.strip()}\n"
        elif primary_label == StructuralLabel.ORDERED_LIST_ITEM:
            # Streaming: each fragment is independent, so use paragraph format
            # with indentation to approximate the grouped layout
            import re as _re
            indent = "  " * max(0, nesting - 1)
            escaped = _re.sub(r'^(\d+)\.', r'\1\\.', inline_text.strip())
            return f"\n\n{_hard_breaks(indent + escaped)}"
        elif primary_label == StructuralLabel.UNORDERED_LIST_ITEM:
            indent = "  " * max(0, nesting - 1)
            return f"\n\n{_hard_breaks(indent + '- ' + inline_text.strip())}"
        elif primary_label == StructuralLabel.BLOCKQUOTE:
            return f"\n\n> {inline_text.strip()}\n"
        elif primary_label == StructuralLabel.CODE_BLOCK:
            return f"\n\n```\n{inline_text.strip()}\n```\n"
        elif primary_label == StructuralLabel.DISPLAY_MATH:
            latex = self._find_formula_latex(sent_ann.char_start, sent_ann.char_end)
            if latex:
                return f"\n\n$$\n{_sanitize_for_katex(latex)}\n$$"
            # No valid OCR LaTeX — output as regular text
            return f"\n\n{_hard_breaks(_clean_unicode_math(inline_text.strip()))}"
        else:
            # Paragraph or list item — inject inline math as $...$ markers
            math_text = self._inject_inline_math(inline_text, sent_ann.char_start, sent_ann.char_end)
            # Paragraph — needs \n\n separator like merge_engine._format_block
            return f"\n\n{_hard_breaks(math_text.strip())}"