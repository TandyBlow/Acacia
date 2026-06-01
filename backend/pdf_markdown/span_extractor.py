"""
Extract spans from PDF with exact character positions and font metadata.

Walks PyMuPDF's get_text("dict") output, flattening blocks→lines→spans
while accumulating global character offsets. Bboxes are kept in page-local
coordinate space (PDF points) for spatial alignment with formula extraction.

This module is the SINGLE SOURCE OF TRUTH for the text layout. All downstream
position-based operations (formula extraction, metadata markers, merge engine,
LLM annotation) use offsets computed here. Text must be reconstructed via
spans_to_text() to maintain alignment — NEVER use parse_pdf() text with these
offsets.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from .annotation_schema import StructuralLabel

logger = logging.getLogger(__name__)

MONO_KEYWORDS = (
    "courier", "mono", "consolas", "code", "source code",
    "typewriter", "menlo", "dejavu sans mono", "liberation mono",
    "fira code", "jetbrains", "cascadia", "inconsolata",
)


@dataclass
class Span:
    """A single span from PyMuPDF's get_text('dict')."""
    text: str
    char_start: int      # global character offset in document
    char_end: int        # exclusive
    font_name: str
    font_size: float
    is_bold: bool         # flags & 16
    is_italic: bool       # flags & 2
    is_monospace: bool    # flags & 8 or mono font name
    bbox: tuple[float, float, float, float]  # (x0, y0, x1, y1) in page points
    page_number: int
    separator_after: str = ""  # "\n" (inter-line) or "\n\n" (inter-block/page) or ""


@dataclass
class SpanGroup:
    """A group of consecutive spans sharing the same format state."""
    spans: list[Span]
    is_bold: bool
    is_italic: bool
    is_monospace: bool
    text: str             # concatenated text
    char_start: int       # start of first span
    char_end: int         # end of last span (exclusive, not including separator)


def _is_mono_font(font_name: str) -> bool:
    return any(kw in font_name.lower() for kw in MONO_KEYWORDS)


def _calc_span_flags(flags: int, font_name: str) -> tuple[bool, bool, bool]:
    """Extract (is_bold, is_italic, is_monospace) from PyMuPDF span flags."""
    is_bold = bool(flags & 16)
    is_italic = bool(flags & 2)
    is_mono = bool(flags & 8) or _is_mono_font(font_name)
    return is_bold, is_italic, is_mono


def extract_spans(file_path: str) -> list[Span]:
    """Extract all spans from a PDF with exact character positions and bboxes.

    Walks every page via get_text("dict"), flattening blocks→lines→spans
    while accumulating a global character offset.

    The offset model:
    - +1 between lines within a block (inter-line \n)
    - +2 between blocks (paragraph break \n\n)
    - +2 between pages (page break \n\n)

    Ligatures and control characters are sanitized at the span level BEFORE
    offset computation, so char_start/char_end naturally reflect the cleaned
    text length.
    """
    try:
        import fitz
    except ImportError:
        raise ImportError("pymupdf is required. Install: pip install pymupdf")

    from file_parser import sanitize_control_chars

    doc = fitz.open(file_path)
    spans: list[Span] = []
    global_offset = 0

    try:
        for page_num, page in enumerate(doc):
            page_dict = page.get_text("dict")
            text_blocks = [b for b in page_dict.get("blocks", []) if b.get("type") == 0]

            for block_idx, block in enumerate(text_blocks):
                lines = block.get("lines", [])

                for line_idx, line in enumerate(lines):
                    line_spans = line.get("spans", [])

                    # Collect valid spans for this line first, then detect
                    # inter-span gaps that need space insertion.
                    line_span_data: list[dict] = []
                    for sp in line_spans:
                        text = sp.get("text", "")
                        if not text:
                            continue
                        text = sanitize_control_chars(text)
                        flags = sp.get("flags", 0)
                        font = sp.get("font", "")
                        is_bold, is_italic, is_mono = _calc_span_flags(flags, font)
                        bbox_raw = sp.get("bbox", (0, 0, 0, 0))
                        bbox = tuple(float(v) for v in bbox_raw)
                        line_span_data.append({
                            "text": text,
                            "bbox": bbox,
                            "font": font,
                            "font_size": round(sp.get("size", 0), 1),
                            "is_bold": is_bold,
                            "is_italic": is_italic,
                            "is_mono": is_mono,
                        })

                    # Detect inter-span gaps within the same line that represent
                    # visual spaces not present in the text stream.
                    # PDF spans sometimes split "Ω to" into "Ω" + "to" with no
                    # space character, but the bbox gap shows the visual space.
                    for i in range(len(line_span_data) - 1):
                        cur = line_span_data[i]
                        nxt = line_span_data[i + 1]
                        # Only check horizontal gaps (same line = similar y)
                        if cur["bbox"][3] > 0 and nxt["bbox"][3] > 0:
                            gap = nxt["bbox"][0] - cur["bbox"][2]
                            # Threshold: 25% of the average character width
                            avg_char_w = (cur["bbox"][2] - cur["bbox"][0]) / max(len(cur["text"]), 1)
                            if gap > max(avg_char_w * 0.25, 1.0) and not cur["text"].endswith(" "):
                                cur["text"] += " "

                    # Now create Span objects with adjusted offsets
                    for sd in line_span_data:
                        char_start = global_offset
                        char_end = global_offset + len(sd["text"])
                        global_offset = char_end

                        span = Span(
                            text=sd["text"],
                            char_start=char_start,
                            char_end=char_end,
                            font_name=sd["font"],
                            font_size=sd["font_size"],
                            is_bold=sd["is_bold"],
                            is_italic=sd["is_italic"],
                            is_monospace=sd["is_mono"],
                            bbox=sd["bbox"],
                            page_number=page_num,
                            separator_after="",
                        )
                        spans.append(span)

                    # Inter-line separator: +1 for \n, only between lines
                    if line_idx < len(lines) - 1:
                        global_offset += 1

                # Inter-block separator: +2 for \n\n (paragraph break)
                # Also serves as inter-page separator when last block on page
                global_offset += 2
    finally:
        doc.close()

    # Post-pass: assign separator_after based on offset gaps between consecutive spans
    for i in range(len(spans)):
        if i < len(spans) - 1:
            gap = spans[i + 1].char_start - spans[i].char_end
            if gap == 0:
                spans[i].separator_after = ""
            elif gap == 1:
                spans[i].separator_after = "\n"
            elif gap >= 2:
                spans[i].separator_after = "\n\n"
        else:
            # Last span: no trailing separator needed
            spans[i].separator_after = ""

    return spans


def group_spans(spans: list[Span]) -> list[SpanGroup]:
    """Merge consecutive spans with identical bold/italic/monospace state.

    Does NOT merge across page boundaries — spans from different pages have
    different spatial positions and should never be grouped together.
    """
    if not spans:
        return []

    groups: list[SpanGroup] = []
    cur_spans: list[Span] = [spans[0]]
    cur_state = (spans[0].is_bold, spans[0].is_italic, spans[0].is_monospace)

    for span in spans[1:]:
        state = (span.is_bold, span.is_italic, span.is_monospace)
        same_page = span.page_number == cur_spans[-1].page_number

        if state == cur_state and same_page:
            cur_spans.append(span)
        else:
            text = "".join(s.text for s in cur_spans)
            groups.append(SpanGroup(
                spans=cur_spans,
                is_bold=cur_state[0],
                is_italic=cur_state[1],
                is_monospace=cur_state[2],
                text=text,
                char_start=cur_spans[0].char_start,
                char_end=cur_spans[-1].char_end,
            ))
            cur_spans = [span]
            cur_state = state

    if cur_spans:
        text = "".join(s.text for s in cur_spans)
        groups.append(SpanGroup(
            spans=cur_spans,
            is_bold=cur_state[0],
            is_italic=cur_state[1],
            is_monospace=cur_state[2],
            text=text,
            char_start=cur_spans[0].char_start,
            char_end=cur_spans[-1].char_end,
        ))

    return groups


def spans_to_text(spans: list[Span]) -> str:
    """Reconstruct plain text from extracted spans, including all separators.

    The reconstructed text EXACTLY matches the offset model used by
    extract_spans(): span.char_start and span.char_end positions are valid
    indices into this text, and text[span.char_start:span.char_end] == span.text.
    """
    if not spans:
        return ""
    parts: list[str] = []
    for span in spans:
        parts.append(span.text)
        parts.append(span.separator_after)
    return "".join(parts)


def detect_body_size(spans: list[Span]) -> float:
    """Detect the body text font size (mode of all sizes)."""
    from collections import Counter

    sizes = [s.font_size for s in spans if s.font_size > 0]
    if not sizes:
        return 12.0

    size_counts = Counter(sizes)
    min_count = max(len(sizes) * 0.005, 2)
    common_sizes = {s for s, c in size_counts.items() if c >= min_count}
    if common_sizes:
        return max(common_sizes, key=lambda s: size_counts[s])
    return size_counts.most_common(1)[0][0]