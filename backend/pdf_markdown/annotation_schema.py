"""
Structural annotation types for PDF-to-Markdown conversion.

The LLM outputs labels + character position ranges. Deterministic code
inserts markdown markers at those positions. Text characters never pass
through the LLM's generation pathway.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class StructuralLabel(str, Enum):
    HEADING_1 = "heading_1"
    HEADING_2 = "heading_2"
    HEADING_3 = "heading_3"
    HEADING_4 = "heading_4"
    ORDERED_LIST_ITEM = "ordered_list_item"
    UNORDERED_LIST_ITEM = "unordered_list_item"
    BLOCKQUOTE = "blockquote"
    MATH = "math"
    DISPLAY_MATH = "display_math"
    PARAGRAPH = "paragraph"
    CODE_BLOCK = "code_block"


HEADING_LABELS = {
    StructuralLabel.HEADING_1,
    StructuralLabel.HEADING_2,
    StructuralLabel.HEADING_3,
    StructuralLabel.HEADING_4,
}

LIST_LABELS = {
    StructuralLabel.ORDERED_LIST_ITEM,
    StructuralLabel.UNORDERED_LIST_ITEM,
}

HEADING_LEVEL: dict[StructuralLabel, int] = {
    StructuralLabel.HEADING_1: 1,
    StructuralLabel.HEADING_2: 2,
    StructuralLabel.HEADING_3: 3,
    StructuralLabel.HEADING_4: 4,
}


@dataclass
class LabeledSpan:
    """One labeled region at a character position range in the original text."""
    label: StructuralLabel
    char_start: int       # inclusive, absolute position
    char_end: int         # exclusive
    nesting_level: int = 0
    confidence: float = 1.0
    latex_text: str = ""  # OCR-derived LaTeX for math spans (empty for non-math)


@dataclass
class SentenceAnnotation:
    """LLM output for one sentence (plus its context window)."""
    sentence_id: int
    char_start: int
    char_end: int
    labels: list[LabeledSpan] = field(default_factory=list)


class MarkerType(str, Enum):
    BOLD_OPEN = "bold_open"
    BOLD_CLOSE = "bold_close"
    ITALIC_OPEN = "italic_open"
    ITALIC_CLOSE = "italic_close"
    MONO_OPEN = "mono_open"
    MONO_CLOSE = "mono_close"
    CODE_BLOCK_OPEN = "code_block_open"
    CODE_BLOCK_CLOSE = "code_block_close"


@dataclass
class Marker:
    """A markdown marker to insert at a specific character position."""
    type: MarkerType
    position: int


@dataclass
class RuleViolation:
    """A structural rule violation found during review."""
    region: tuple[int, int]   # (char_start, char_end)
    rule_name: str
    severity: str             # "error" | "warning"
    description: str


@dataclass
class SSEMessage:
    """One SSE event for the streaming pipeline."""
    event: str
    data: dict
