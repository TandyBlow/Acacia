"""
Deterministic markdown marker emission from PDF font metadata.

Handles bold, italic, and monospace wrapping. Does NOT produce structural
markers (headings, lists, blockquotes, math) — those come from the LLM.
"""

from __future__ import annotations

from .annotation_schema import Marker, MarkerType
from .span_extractor import Span, SpanGroup, group_spans


def _marker(type_: MarkerType, position: int) -> Marker:
    return Marker(type=type_, position=position)


def apply_metadata_rules(spans: list[Span]) -> dict[int, list[Marker]]:
    """Generate inline-formatting markers from font metadata.

    Merges consecutive spans with identical (bold, italic, mono) state,
    then emits open/close markers at group boundaries.

    Returns:
        Dict mapping character position → list of markers to insert there.
    """
    markers: dict[int, list[Marker]] = {}
    groups = group_spans(spans)

    for group in groups:
        start = group.char_start
        end = group.char_end

        if group.is_bold:
            markers.setdefault(start, []).append(_marker(MarkerType.BOLD_OPEN, start))
            markers.setdefault(end, []).append(_marker(MarkerType.BOLD_CLOSE, end))

        if group.is_italic:
            markers.setdefault(start, []).append(_marker(MarkerType.ITALIC_OPEN, start))
            markers.setdefault(end, []).append(_marker(MarkerType.ITALIC_CLOSE, end))

        if group.is_monospace:
            markers.setdefault(start, []).append(_marker(MarkerType.MONO_OPEN, start))
            markers.setdefault(end, []).append(_marker(MarkerType.MONO_CLOSE, end))

    return markers


def detect_code_blocks(spans: list[Span]) -> list[tuple[int, int]]:
    """Detect monospace block regions (fenced code blocks).

    Returns list of (char_start, char_end) for code block regions.
    These should be wrapped in ``` markers.
    """
    if not spans:
        return []

    # Group spans by page and detect consecutive mono spans forming blocks
    groups = group_spans(spans)
    blocks: list[tuple[int, int]] = []

    i = 0
    while i < len(groups):
        group = groups[i]
        if group.is_monospace and len(group.text.strip()) > 0:
            # Check if this is a substantial mono block (not inline code)
            if len(group.text) > 40 or '\n' in group.text:
                blocks.append((group.char_start, group.char_end))
            # Merge adjacent mono groups separated only by newlines
            j = i + 1
            while j < len(groups):
                between = groups[j]
                if between.is_monospace:
                    blocks[-1] = (blocks[-1][0], between.char_end)
                    i = j
                    j += 1
                elif between.text.strip() == '':
                    j += 1
                else:
                    break
        i += 1

    return blocks
