"""
Two-layer validation for LLM structural annotations.

Layer 1: Deterministic rule checks (no LLM, always runs).
Layer 2: LLM review of rule-violating regions.
"""

from __future__ import annotations

import logging

from .annotation_schema import (
    StructuralLabel,
    SentenceAnnotation,
    LabeledSpan,
    RuleViolation,
    HEADING_LABELS,
    LIST_LABELS,
    HEADING_LEVEL,
)

logger = logging.getLogger(__name__)


def check_annotation_rules(
    annotations: list[SentenceAnnotation],
    text: str,
) -> list[RuleViolation]:
    """Run deterministic structural rule checks.

    Returns list of RuleViolation objects. Empty list means all checks passed.
    """
    violations: list[RuleViolation] = []
    violations.extend(_check_interval_coverage(annotations, text))
    violations.extend(_check_heading_nesting(annotations))
    violations.extend(_check_list_continuity(annotations))
    violations.extend(_check_boundary_integrity(annotations, text))
    violations.extend(_check_false_code_blocks(annotations, text))
    return violations


def _check_interval_coverage(
    annotations: list[SentenceAnnotation],
    text: str,
) -> list[RuleViolation]:
    """Check that all characters are covered and no labels overlap."""
    violations: list[RuleViolation] = []
    text_len = len(text)

    # Track which characters are claimed by labels
    coverage: dict[int, int] = {}  # char_pos → number of labels claiming it

    for sent_ann in annotations:
        for label in sent_ann.labels:
            for i in range(label.char_start, min(label.char_end, text_len)):
                coverage[i] = coverage.get(i, 0) + 1

    # Check for overlaps (multiple labels claiming same character)
    overlap_starts: list[int] = []
    for i in sorted(coverage.keys()):
        if coverage[i] > 1:
            if not overlap_starts or i > overlap_starts[-1] + 1:
                overlap_starts.append(i)

    for start in overlap_starts:
        end = start
        while end + 1 in coverage and coverage[end + 1] > 1:
            end += 1
        violations.append(RuleViolation(
            region=(start, end + 1),
            rule_name="INTERVAL_OVERLAP",
            severity="error",
            description=f"Characters {start}-{end + 1} claimed by {coverage[start]} labels",
        ))

    # Check for gaps (no label claiming a visible character)
    gap_starts: list[int] = []
    for i in range(text_len):
        if text[i].strip() and i not in coverage:
            if not gap_starts or i > gap_starts[-1] + 1:
                gap_starts.append(i)

    for start in gap_starts[:5]:  # Cap to avoid flooding
        end = start
        while end + 1 < text_len and end + 1 not in coverage and text[end + 1].strip():
            end += 1
        violations.append(RuleViolation(
            region=(start, end + 1),
            rule_name="INTERVAL_GAP",
            severity="warning",
            description=f"Characters {start}-{end + 1} not covered by any label",
        ))

    return violations


def _check_heading_nesting(
    annotations: list[SentenceAnnotation],
) -> list[RuleViolation]:
    """Check that heading levels never skip (h1→h3 without h2 is invalid)."""
    violations: list[RuleViolation] = []
    headings: list[tuple[int, StructuralLabel, int, int]] = []

    for sent_ann in annotations:
        for label in sent_ann.labels:
            if label.label in HEADING_LABELS:
                headings.append((
                    label.char_start,
                    label.label,
                    HEADING_LEVEL.get(label.label, 0),
                    label.char_end,
                ))

    if len(headings) < 2:
        return violations

    for i in range(len(headings) - 1):
        _, _, current_level, _ = headings[i]
        _, next_label, next_level, next_end = headings[i + 1]

        if next_level > current_level + 1:
            violations.append(RuleViolation(
                region=(headings[i][0], next_end),
                rule_name="HEADING_NESTING",
                severity="error",
                description=(
                    f"Heading level jump from {current_level} to {next_level} "
                    f"({headings[i][1].value} → {next_label.value}) — skipped level {current_level + 1}"
                ),
            ))

    # Also check: at most one h1
    h1_count = sum(1 for _, label, _, _ in headings if label == StructuralLabel.HEADING_1)
    if h1_count > 1:
        h1_regions = [(s, e) for s, lbl, _, e in headings if lbl == StructuralLabel.HEADING_1]
        violations.append(RuleViolation(
            region=(h1_regions[0][0], h1_regions[-1][1]),
            rule_name="MULTIPLE_H1",
            severity="warning",
            description=f"Found {h1_count} h1 headings — document should have exactly one title",
        ))

    return violations


def _check_list_continuity(
    annotations: list[SentenceAnnotation],
) -> list[RuleViolation]:
    """Check that ordered list numbering is consistent at each nesting level."""
    violations: list[RuleViolation] = []

    # Group ordered list items by nesting level
    items_by_level: dict[int, list[tuple[int, int]]] = {}

    for sent_ann in annotations:
        for label in sent_ann.labels:
            if label.label == StructuralLabel.ORDERED_LIST_ITEM:
                level = label.nesting_level
                items_by_level.setdefault(level, []).append((label.char_start, label.char_end))

    # For each level, check the sequence looks reasonable
    # Flag levels with only 1 item as potential issues
    for level, items in items_by_level.items():
        if len(items) < 1:
            continue
        if len(items) == 1 and level > 1:
            violations.append(RuleViolation(
                region=(items[0][0], items[0][1]),
                rule_name="LIST_SINGLE_ITEM",
                severity="warning",
                description=f"Single ordered list item at nesting level {level} — possible mislabel",
            ))

    return violations


def _check_boundary_integrity(
    annotations: list[SentenceAnnotation],
    text: str,
) -> list[RuleViolation]:
    """Check that label boundaries don't split mid-word."""
    violations: list[RuleViolation] = []

    for sent_ann in annotations:
        for label in sent_ann.labels:
            start = label.char_start
            end = label.char_end

            # Check start: is it at a whitespace boundary or sentence start?
            if start > 0 and text[start - 1].isalnum() and text[start].isalnum():
                # Label starts mid-word — look backward to find word start
                word_start = start - 1
                while word_start > 0 and text[word_start - 1].isalnum():
                    word_start -= 1
                violations.append(RuleViolation(
                    region=(word_start, end),
                    rule_name="BOUNDARY_MID_WORD_START",
                    severity="warning",
                    description=f"Label starts mid-word at position {start}",
                ))

            # Check end: is it at a whitespace boundary or sentence end?
            if end < len(text) and text[end - 1].isalnum() and end < len(text) and text[end].isalnum():
                word_end = end
                while word_end < len(text) and text[word_end].isalnum():
                    word_end += 1
                violations.append(RuleViolation(
                    region=(start, word_end),
                    rule_name="BOUNDARY_MID_WORD_END",
                    severity="warning",
                    description=f"Label ends mid-word at position {end}",
                ))

    return violations


def filter_error_violations(violations: list[RuleViolation]) -> list[RuleViolation]:
    """Return only error-severity violations."""
    return [v for v in violations if v.severity == "error"]


def filter_warning_violations(violations: list[RuleViolation]) -> list[RuleViolation]:
    """Return only warning-severity violations."""
    return [v for v in violations if v.severity == "warning"]


def llm_review_violations(
    violations: list[RuleViolation],
    text: str,
    original_annotations: list[SentenceAnnotation],
) -> list[SentenceAnnotation]:
    """Send rule-violating regions to LLM for re-annotation.

    Only reviews error-level violations. Warnings are logged but not re-annotated.
    Returns corrected annotations (merges fixes with original).
    """
    errors = filter_error_violations(violations)
    if not errors:
        logger.info("No error-level violations to review")
        return original_annotations

    # Build a set of affected sentence IDs
    affected_ids: set[int] = set()
    for violation in errors:
        v_start, v_end = violation.region
        for sent_ann in original_annotations:
            if sent_ann.char_start <= v_start < sent_ann.char_end or \
               sent_ann.char_start < v_end <= sent_ann.char_end:
                affected_ids.add(sent_ann.sentence_id)

    if not affected_ids:
        return original_annotations

    logger.info(f"LLM review: {len(errors)} violations affecting {len(affected_ids)} sentences")

    # Build segments for affected sentences with context
    from .text_segmenter import Segment
    affected_segments: list[Segment] = []
    for sent_ann in original_annotations:
        if sent_ann.sentence_id in affected_ids:
            # Include surrounding context (200 chars each side)
            ctx_before = text[max(0, sent_ann.char_start - 200):sent_ann.char_start]
            ctx_after = text[sent_ann.char_end:min(len(text), sent_ann.char_end + 200)]
            affected_segments.append(Segment(
                sentence_id=sent_ann.sentence_id,
                text=text[sent_ann.char_start:sent_ann.char_end],
                char_start=sent_ann.char_start,
                char_end=sent_ann.char_end,
                context_before=ctx_before,
                context_after=ctx_after,
            ))

    # Call LLM for re-annotation
    from .llm_annotator import annotate_chunk
    try:
        corrected_annotations = annotate_chunk(affected_segments, text)
    except RuntimeError as e:
        logger.warning(f"LLM review re-annotation failed: {e}")
        # Fall back to paragraph (previous stub behavior)
        corrected_annotations = [
            SentenceAnnotation(
                sentence_id=seg.sentence_id,
                char_start=seg.char_start,
                char_end=seg.char_end,
                labels=[LabeledSpan(
                    label=StructuralLabel.PARAGRAPH,
                    char_start=seg.char_start,
                    char_end=seg.char_end,
                    confidence=0.0,
                )],
            )
            for seg in affected_segments
        ]

    # Merge corrected annotations back into original list
    corrected_dict = {sa.sentence_id: sa for sa in corrected_annotations}
    result: list[SentenceAnnotation] = []
    for sent_ann in original_annotations:
        if sent_ann.sentence_id in corrected_dict:
            result.append(corrected_dict[sent_ann.sentence_id])
        else:
            result.append(sent_ann)

    return result


# Common English words for natural language detection
_COMMON_WORDS = frozenset({
    "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would",
    "can", "could", "may", "might", "shall", "should",
    "and", "but", "or", "nor", "not", "so", "yet", "for",
    "if", "then", "than", "that", "this", "these", "those",
    "a", "an", "of", "in", "on", "at", "to", "from", "by",
    "with", "about", "into", "through", "during", "before",
    "after", "above", "below", "between", "under", "over",
    "we", "you", "they", "it", "he", "she", "me", "us",
    "also", "because", "since", "while", "although", "however",
    "therefore", "thus", "hence", "moreover", "furthermore",
    "example", "definition", "remark", "note", "case", "proof",
    "theorem", "lemma", "corollary", "proposition",
})


def _check_false_code_blocks(
    annotations: list[SentenceAnnotation],
    text: str,
) -> list[RuleViolation]:
    """Detect code_block labels covering natural language, not actual code.

    Math-heavy academic paragraphs sometimes get mislabeled as code_block
    because they contain symbols and notation. A genuine code block should
    contain programming constructs (function definitions, variable assignments,
    loop structures) rather than English sentences and mathematical prose.
    """
    violations: list[RuleViolation] = []

    for sent_ann in annotations:
        for label in sent_ann.labels:
            if label.label != StructuralLabel.CODE_BLOCK:
                continue

            # Extract the labeled text
            if label.char_end > len(text):
                continue
            block_text = text[label.char_start:label.char_end]

            # Count common English words in the block
            words = block_text.lower().split()
            common_count = sum(1 for w in words if w.rstrip(".,;:!?") in _COMMON_WORDS)
            word_ratio = common_count / max(len(words), 1)

            # Heuristic: if >15% of words are common English words and the block
            # has >6 words, it's very likely natural language, not code
            if len(words) > 6 and word_ratio > 0.15:
                violations.append(RuleViolation(
                    region=(label.char_start, label.char_end),
                    rule_name="FALSE_CODE_BLOCK",
                    severity="error",
                    description=(
                        f"code_block label covers natural language text "
                        f"(common-word ratio {word_ratio:.0%}, {common_count}/{len(words)} words)"
                    ),
                ))

    return violations