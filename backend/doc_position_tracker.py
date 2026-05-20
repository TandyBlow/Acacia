"""
Document position tracker for line-by-line chat mode.
Code tracks which sentence we're on — the AI no longer needs to
"find its position" by reading conversation history.
"""
import re
from typing import List

# Chinese sentence terminators
_SENTENCE_END = re.compile(r'[。！？；\n]')
# Minimum segment length (chars) — merge shorter ones with the next
_MIN_SEGMENT_LEN = 5


def split_document(full_text: str) -> List[str]:
    """Split document text into explainable segments.

    Splits on Chinese sentence terminators (。！？；\\n).
    Short segments (< _MIN_SEGMENT_LEN chars) get merged with the next one.
    Headings (lines starting with #) stay as their own segment.
    """
    if not full_text or not full_text.strip():
        return []

    # Split into paragraphs first
    paragraphs = full_text.split('\n\n')
    segments: List[str] = []

    for para in paragraphs:
        para = para.strip()
        if not para:
            continue

        # If it's a heading, keep as is
        if re.match(r'^#{1,6}\s', para):
            segments.append(para)
            continue

        # Split paragraph on sentence terminators
        parts = re.split(r'(?<=[。！？；\n])', para)
        current = ""

        for part in parts:
            part = part.strip()
            if not part:
                continue
            current += part
            # Emit segment when we hit a terminator or have enough content
            if _SENTENCE_END.search(part) and len(current.strip()) >= _MIN_SEGMENT_LEN:
                segments.append(current.strip())
                current = ""

        # Don't lose trailing content
        if current.strip():
            if segments and len(current.strip()) < _MIN_SEGMENT_LEN:
                segments[-1] += current.strip()
            else:
                segments.append(current.strip())

    return segments


def get_current_segment(session: dict) -> str:
    """Get the current document segment based on code-tracked position."""
    segments = session.get("doc_segments", [])
    pos = session.get("current_position", 0)
    if pos < len(segments):
        return segments[pos]
    return ""


def advance_position(session: dict) -> bool:
    """Advance to the next segment. Returns True if more segments remain."""
    segments = session.get("doc_segments", [])
    pos = session.get("current_position", 0) + 1
    session["current_position"] = pos
    return pos < len(segments)


def get_progress_context(session: dict) -> str:
    """Build a progress indicator string, e.g. '第 3/15 句'."""
    segments = session.get("doc_segments", [])
    pos = session.get("current_position", 0)
    total = len(segments)
    if total == 0:
        return ""
    current_num = min(pos + 1, total)
    return f"第 {current_num}/{total} 句"


def is_document_done(session: dict) -> bool:
    """Check if all segments have been covered."""
    segments = session.get("doc_segments", [])
    pos = session.get("current_position", 0)
    return pos >= len(segments)
