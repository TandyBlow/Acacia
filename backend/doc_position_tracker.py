"""
Document position tracker for line-by-line chat mode.
Code tracks which sentence we're on — the AI no longer needs to
"find its position" by reading conversation history.
"""
import re
from typing import List

# Sentence terminators — Chinese and English
_SENTENCE_END = re.compile(r'[。！？；\.!\?\n]')
# Minimum segment length (chars) — merge shorter ones with the next
_MIN_SEGMENT_LEN = 5
# Maximum segment length (chars) — force split if exceeded
_MAX_SEGMENT_LEN = 200


def _find_split_point(text: str, max_len: int) -> int:
    """Find the best position to split text, near max_len, at a natural boundary."""
    if len(text) <= max_len:
        return -1

    lower_bound = int(max_len * 0.3)

    # 1. Sentence boundary: ". " or ".\n" followed by capital letter
    for m in re.finditer(r'\.\s+(?=[A-Z])', text):
        pos = m.end()
        if lower_bound < pos <= max_len:
            return pos

    # 2. Semicolon boundary: "; " followed by capital or letter
    for m in re.finditer(r';\s+(?=[A-Z])', text):
        pos = m.end()
        if lower_bound < pos <= max_len:
            return pos

    # 3. Before numbered items: " 1. ", " 2) "
    for m in re.finditer(r'\s+(?=\d+[\.\)]\s+)', text):
        pos = m.start()
        if lower_bound < pos <= max_len:
            return pos

    # 4. Before lettered items: " (a) ", " (b) "
    for m in re.finditer(r'\s+(?=\([a-z]\)\s)', text):
        pos = m.start()
        if lower_bound < pos <= max_len:
            return pos

    # 5. Before section headers
    for m in re.finditer(r'\s+(?=(?:PART|Chapter|Section|UNIT|Module)\s)', text):
        pos = m.start()
        if lower_bound < pos <= max_len:
            return pos

    # 6. Fallback: split at last space before max_len
    split_at = text.rfind(' ', lower_bound, max_len)
    if split_at > lower_bound:
        return split_at

    # 7. Last resort: first space past max_len
    split_at = text.find(' ', max_len)
    if split_at > 0:
        return split_at

    return -1


def _force_split_long(text: str, max_len: int) -> List[str]:
    """Split a single overly-long segment at the best available boundary."""
    split_at = _find_split_point(text, max_len)
    if split_at <= 0:
        return [text]

    left = text[:split_at].strip()
    right = text[split_at:].strip()
    if not left or not right:
        return [text]

    return _force_split_long(left, max_len) + _force_split_long(right, max_len)


def split_document(full_text: str) -> List[str]:
    """Split document text into explainable segments.

    Splits on Chinese and English sentence terminators.
    Short segments (< _MIN_SEGMENT_LEN chars) get merged with the next one.
    Oversized segments (> _MAX_SEGMENT_LEN chars) are force-split at natural boundaries.
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

        # Normalize English sentence boundaries so the split-on-newline
        # path below can catch them. ". " + capital → ".\\n"
        # \s* handles both "foo. Bar" and garbled "foo.Bar" (missing space).
        # Deliberately NOT matching ". " + lowercase (e.g. "e.g. a") or
        # ". " + digit (e.g. "1. Something") — those are list items.
        para = re.sub(r'([.!?])\s*([A-Z])', r'\1\n\2', para)
        # Semicolons followed by a letter also mark clause/item boundaries
        para = re.sub(r';\s*([A-Za-z])', r';\n\1', para)

        # Split paragraph on Chinese terminators + newlines (from normalization).
        # English . ! ? are NOT in the split class — only the \n inserted above
        # represents true English sentence boundaries.
        parts = re.split(r'(?<=[。！？；\n])', para)
        current = ""

        for part in parts:
            part = part.strip()
            if not part:
                continue
            current += part
            # Emit segment when we hit a terminator and have enough content
            if _SENTENCE_END.search(part) and len(current.strip()) >= _MIN_SEGMENT_LEN:
                segments.append(current.strip())
                current = ""

        # Don't lose trailing content
        if current.strip():
            if segments and len(current.strip()) < _MIN_SEGMENT_LEN:
                segments[-1] += current.strip()
            else:
                segments.append(current.strip())

    # Second pass: force-split oversized segments
    result: List[str] = []
    for seg in segments:
        if len(seg) > _MAX_SEGMENT_LEN:
            result.extend(_force_split_long(seg, _MAX_SEGMENT_LEN))
        else:
            result.append(seg)

    return result


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


def get_full_document(session: dict) -> str:
    """Return the full original document text stored in the session."""
    return session.get("full_document", "")


def get_position_marker(session: dict) -> str:
    """Build a position marker showing current location in the full document.

    Returns a string like '第 3/15 段' that marks where the AI is in the document.
    """
    segments = session.get("doc_segments", [])
    pos = session.get("current_position", 0)
    total = len(segments)
    if total == 0:
        return ""
    return f"第 {min(pos + 1, total)}/{total} 段"


def get_context_window(session: dict, window_size: int = 3, future_preview_chars: int = 80) -> str:
    """Return a window of segments around the current position.

    Instead of dumping the entire document into every prompt (which dilutes
    attention), give the AI just enough surrounding context to understand
    where it is. When the user asks about something outside the window,
    code searches the full document separately.

    Future segments (not yet explained) are truncated to a short preview
    so the AI has directional awareness without enough detail to spoil.

    Args:
        session: Chat session dict with doc_segments and current_position.
        window_size: Number of segments before and after current position.
        future_preview_chars: Max chars to show for segments after current pos.

    Returns:
        Formatted string showing the context window with current position marked.
    """
    segments = session.get("doc_segments", [])
    pos = session.get("current_position", 0)
    total = len(segments)
    if total == 0:
        return ""

    start = max(0, pos - window_size)
    end = min(total, pos + window_size + 1)

    lines = []
    if start > 0:
        lines.append(f"...（前面还有 {start} 段，已讲解过）")
    for i in range(start, end):
        marker = "  ← 当前要讲解的" if i == pos else ""
        text = segments[i]
        if i > pos:
            text = text[:future_preview_chars] + ("..." if len(segments[i]) > future_preview_chars else "")
        lines.append(f"段{i + 1}/{total}{marker}:\n{text}")
    if end < total:
        lines.append(f"...（后面还有 {total - end} 段，尚未讲到）")

    return "\n\n".join(lines)
