"""
Merge metadata markers with LLM structural annotations into final Markdown.

Block-based approach: text is split into contiguous regions by structural label,
then each block is formatted as a unit. Paragraphs get single blank-line
separation; inline formatting is applied within blocks.
"""

from __future__ import annotations

import logging
import re

from .annotation_schema import (
    StructuralLabel,
    LabeledSpan,
    SentenceAnnotation,
    Marker,
    MarkerType,
    HEADING_LABELS,
    LIST_LABELS,
    HEADING_LEVEL,
)

logger = logging.getLogger(__name__)

_HEADING_PREFIX = {StructuralLabel.HEADING_1: "# ",
                   StructuralLabel.HEADING_2: "## ",
                   StructuralLabel.HEADING_3: "### ",
                   StructuralLabel.HEADING_4: "#### "}

# Priority order for structural labels. Applied in this order so
# higher-priority labels cannot be overwritten by lower-priority ones.
STRUCTURAL_PRIORITY = [
    StructuralLabel.CODE_BLOCK,
    StructuralLabel.BLOCKQUOTE,
    StructuralLabel.ORDERED_LIST_ITEM,
    StructuralLabel.UNORDERED_LIST_ITEM,
    StructuralLabel.HEADING_1,
    StructuralLabel.HEADING_2,
    StructuralLabel.HEADING_3,
    StructuralLabel.HEADING_4,
    StructuralLabel.DISPLAY_MATH,
]


def _build_formula_text_map(formula_spans: list[LabeledSpan]) -> dict[int, str]:
    """Build a map from char_start position to latex_text for DISPLAY_MATH formulas only.

    Only DISPLAY_MATH formula spans need OCR LaTeX lookup — these are rendered
    as $$ blocks.  MATH (inline) formula spans use unicode_to_latex instead
    of this map, so including them would cause DISPLAY_MATH blocks to pick up
    partial inline LaTeX like "{\\emptyset" from a MATH span that overlaps.
    """
    result: dict[int, str] = {}
    for fs in formula_spans:
        if fs.latex_text and fs.label == StructuralLabel.DISPLAY_MATH:
            result[fs.char_start] = fs.latex_text
    return result


def _build_char_labels(
    text: str,
    llm_annotations: list[SentenceAnnotation],
    formula_spans: list[LabeledSpan],
) -> tuple[dict[int, StructuralLabel], list[tuple[int, int]]]:
    """Per-character structural label map and inline math region list.

    Returns (char_labels, math_regions) where:
    - char_labels maps each character to its structural label (paragraph,
      heading, list item, display math, etc.)
    - math_regions is a list of (char_start, char_end) pairs for inline
      MATH regions that should be treated as positional markers, not blocks.

    Inline MATH does NOT change the structural label — it's tracked
    separately so it can be injected as $...$ markers within paragraphs
    and list items. Only DISPLAY_MATH overrides the structural label.
    """
    char_labels: dict[int, StructuralLabel] = {}
    for i in range(len(text)):
        char_labels[i] = StructuralLabel.PARAGRAPH

    # Apply LLM labels in priority order — only overwrite PARAGRAPH positions
    for label_type in STRUCTURAL_PRIORITY:
        for sent_ann in llm_annotations:
            for ls in sent_ann.labels:
                if ls.label != label_type:
                    continue
                for i in range(ls.char_start, min(ls.char_end, len(text))):
                    if char_labels[i] == StructuralLabel.PARAGRAPH:
                        char_labels[i] = ls.label

    # Collect inline MATH regions (tracked separately, NOT applied to char_labels)
    math_regions: list[tuple[int, int]] = []
    # Apply DISPLAY_MATH labels — these override any label since they
    # genuinely need their own block with $$...$$
    for fs in formula_spans:
        if fs.label == StructuralLabel.DISPLAY_MATH:
            for i in range(fs.char_start, min(fs.char_end, len(text))):
                char_labels[i] = StructuralLabel.DISPLAY_MATH
        elif fs.label == StructuralLabel.MATH:
            # Trim leading/trailing whitespace and set-notation braces from
            # math region boundaries.  Formula spans inherit span boundaries
            # which can include adjacent whitespace (e.g. "∅ ") and braces
            # (e.g. "{∅") that are set notation, not LaTeX content.
            # Braces at boundaries stay outside the $...$ wrapper as regular
            # text, which renders correctly in browsers.
            # Also trim trailing ASCII letters/digits that are not math symbols.
            # Spans like "∈S" have high math density but "S" at the end is
            # plain text, not LaTeX.  It should stay outside $...$ as regular
            # text: "$\in$ S" instead of "$\inS$" (which KaTeX can't parse).
            start = fs.char_start
            end = min(fs.char_end, len(text))
            # Trim leading whitespace/punctuation/braces
            while start < end and text[start] in (' ', '\n', '{', '}', ',', '.', ';', ':'):
                start += 1
            # Trim trailing whitespace/punctuation/braces
            while end > start and text[end - 1] in (' ', '\n', '{', '}', ',', '.', ';', ':'):
                end -= 1
            if start < end:
                math_regions.append((start, end))

    # Merge overlapping/adjacent math regions into continuous spans
    if math_regions:
        math_regions.sort()
        merged: list[tuple[int, int]] = []
        for start, end in math_regions:
            if merged and start <= merged[-1][1]:
                merged[-1] = (merged[-1][0], max(merged[-1][1], end))
            else:
                merged.append((start, end))
        math_regions = merged

    return char_labels, math_regions


def _extract_blocks(
    text: str,
    char_labels: dict[int, StructuralLabel],
    llm_annotations: list[SentenceAnnotation],
    math_regions: list[tuple[int, int]] | None = None,
) -> list[dict]:
    """Split text into contiguous blocks of the same structural label.

    Inline MATH (single symbols like σ, Ω, ∅) is NOT treated as a
    separate block. Instead, MATH characters are absorbed into the
    surrounding block (paragraph, list item, heading) and tracked as
    `math_regions` sub-annotations within that block. Only DISPLAY_MATH
    creates its own block.

    Returns list of dicts with: label, text, char_start, char_end,
    nesting_level, math_regions.
    """
    if not text:
        return []

    if math_regions is None:
        math_regions = []

    # Find all label transition points
    transitions: list[int] = [0]
    prev_label = char_labels.get(0, StructuralLabel.PARAGRAPH)

    for i in range(1, len(text)):
        current = char_labels.get(i, StructuralLabel.PARAGRAPH)
        if current != prev_label:
            transitions.append(i)
            prev_label = current
    transitions.append(len(text))

    # Build nesting lookup from LLM annotations
    nesting_map: dict[StructuralLabel, dict[int, int]] = {}
    for sent_ann in llm_annotations:
        for ls in sent_ann.labels:
            nesting_map.setdefault(ls.label, {})[ls.char_start] = ls.nesting_level

    blocks: list[dict] = []
    for j in range(len(transitions) - 1):
        start = transitions[j]
        end = transitions[j + 1]
        label = char_labels.get(start, StructuralLabel.PARAGRAPH)

        chunk = text[start:end]

        # Whitespace-only blocks at label transitions carry paragraph breaks
        # (\n\n). Merge them into the preceding block instead of dropping them,
        # so that "could be\n\n" + "F = {..." preserves the paragraph gap.
        if not chunk.strip():
            if blocks and '\n' in chunk:
                blocks[-1]["text"] += chunk
                # Only extend math_regions with regions that fall within
                # the newly-added whitespace range, NOT the full block range
                # (the existing math_regions already cover the original range)
                old_end = blocks[-1]["char_end"]
                blocks[-1]["char_end"] = end
                new_math = [r for r in math_regions if old_end <= r[0] and r[1] <= end]
                if new_math:
                    blocks[-1]["math_regions"].extend(new_math)
            continue

        # Collect inline MATH regions that fall within this block's range
        block_math = [r for r in math_regions if start <= r[0] and r[1] <= end]

        # Get nesting level for this label at this position
        nesting = 0
        label_nests = nesting_map.get(label, {})
        for nstart, nlevel in sorted(label_nests.items()):
            if nstart <= start:
                nesting = nlevel

        blocks.append({
            "label": label,
            "text": chunk,
            "char_start": start,
            "char_end": end,
            "nesting_level": nesting,
            "math_regions": block_math,
        })

    return blocks


def _apply_all_inline(
    block_text: str,
    block_start: int,
    block_label: StructuralLabel,
    metadata_markers: dict[int, list[Marker]],
    math_regions: list[tuple[int, int]],
    formula_text_map: dict[int, str] | None = None,
) -> str:
    """Apply all inline formatting (bold/italic/mono + math) to block text.

    Both types of inline markers use absolute char positions. By processing
    them together, we avoid position-offset issues that arise when one type
    is applied before the other (which shifts positions for the second pass).

    Math regions get $...$ wrapping. Bold/italic markers that overlap with
    math regions are suppressed (italic on math symbols is typesetting, not
    emphasis). Bold/italic in headings are suppressed.
    """
    if not metadata_markers and not math_regions:
        return block_text

    block_end = block_start + len(block_text)

    # Collect all inline markers (both formatting and math)
    # Build a sorted list of (abs_position, action) tuples
    actions: list[tuple[int, str]] = []  # (abs_pos, text_to_insert)

    # Math regions: wrap in $...$ and convert Unicode symbols to LaTeX
    # We don't replace the entire region text with latex_text from OCR
    # (which can contain fragments like "{\emptyset"). Instead, we wrap
    # the original text in $...$ and apply Unicode→LaTeX conversion inside.
    from .formula_extractor import unicode_to_latex
    for mstart, mend in math_regions:
        if block_start <= mstart and mend <= block_end:
            # Get the original text in this math region
            raw_text = block_text[mstart - block_start:mend - block_start]
            # Convert Unicode math symbols to LaTeX within the original text
            converted = unicode_to_latex(raw_text)
            # Wrap in $...$
            converted = _sanitize_for_katex(converted)
            actions.append((mstart, f"${converted}$"))
            actions.append((mend, ""))  # marker to skip original text up to mend

    # Formatting markers (bold/italic/mono)
    if metadata_markers:
        for pos, marker_list in metadata_markers.items():
            if block_start <= pos <= block_end:
                for m in marker_list:
                    # Suppress italic inside DISPLAY_MATH blocks
                    if block_label == StructuralLabel.DISPLAY_MATH:
                        if m.type in (MarkerType.ITALIC_OPEN, MarkerType.ITALIC_CLOSE):
                            continue
                    # Suppress bold/italic in headings
                    if block_label in HEADING_LABELS:
                        if m.type in (MarkerType.BOLD_OPEN, MarkerType.BOLD_CLOSE,
                                       MarkerType.ITALIC_OPEN, MarkerType.ITALIC_CLOSE):
                            continue
                    # Suppress italic that overlaps with math regions
                    if math_regions and m.type in (MarkerType.ITALIC_OPEN, MarkerType.ITALIC_CLOSE):
                        for mr_start, mr_end in math_regions:
                            if mr_start <= pos <= mr_end:
                                break  # suppress this italic marker
                        else:
                            # Not in a math region — keep it
                            marker_text = {
                                MarkerType.BOLD_OPEN: "**", MarkerType.BOLD_CLOSE: "**",
                                MarkerType.ITALIC_OPEN: "*", MarkerType.ITALIC_CLOSE: "*",
                                MarkerType.MONO_OPEN: "`", MarkerType.MONO_CLOSE: "`",
                            }.get(m.type, "")
                            actions.append((pos, marker_text))
                        continue  # already handled (either suppressed or appended)

                    marker_text = {
                        MarkerType.BOLD_OPEN: "**", MarkerType.BOLD_CLOSE: "**",
                        MarkerType.ITALIC_OPEN: "*", MarkerType.ITALIC_CLOSE: "*",
                        MarkerType.MONO_OPEN: "`", MarkerType.MONO_CLOSE: "`",
                    }.get(m.type, "")
                    actions.append((pos, marker_text))

    if not actions:
        return block_text

    # Sort actions by position. For same position:
    # - Math "skip-end" markers (empty string at mend) should come AFTER
    #   formatting markers at the same position, so formatting applies first
    # - Math "insert" markers should come BEFORE text at the same position
    actions.sort(key=lambda x: (x[0], 0 if x[1] else 1))

    # Build output by interleaving original text and inserted markers
    result: list[str] = []
    prev = block_start
    skip_until = -1  # for math regions: skip original text from prev to this

    for abs_pos, insert_text in actions:
        # Check if this is the skip-end of a math region
        if abs_pos == skip_until and not insert_text:
            prev = abs_pos
            skip_until = -1
            continue

        # Add original text between prev and this action's position
        # Skip any original text that falls within a math region
        # (prev was advanced past the math region when we inserted $...$)
        rel_prev = prev - block_start
        rel_pos = abs_pos - block_start
        if rel_pos > rel_prev:
            result.append(block_text[rel_prev:rel_pos])

        if insert_text:
            result.append(insert_text)
            # If this is a math-region insertion ($...$), skip the original
            # text from mstart to mend by advancing prev to mend
            for mstart, mend in math_regions:
                if abs_pos == mstart and insert_text.startswith("$"):
                    prev = mend  # skip original math text
                    skip_until = mend  # mark so the (mend, "") noop is handled
                    break
            else:
                prev = abs_pos
        else:
            prev = abs_pos

    # Append remaining text
    rel_prev = prev - block_start
    if rel_prev < len(block_text):
        result.append(block_text[rel_prev:])

    return "".join(result)


def _apply_inline_math_to_block(
    block_text: str,
    block_start: int,
    math_regions: list[tuple[int, int]],
    formula_text_map: dict[int, str] | None = None,
) -> str:
    """Inject $...$ markers around inline math regions within a block.

    Math regions are (char_start, char_end) absolute positions that
    fall within [block_start, block_start + len(block_text)]. For
    each region, the original text is replaced with $latex$ or
    $unicode$ depending on whether OCR produced LaTeX.
    """
    if not math_regions or not formula_text_map:
        return block_text

    block_end = block_start + len(block_text)

    # Filter math regions that actually fall within this block
    regions_in_block = [
        (s, e) for s, e in math_regions
        if block_start <= s and e <= block_end
    ]
    if not regions_in_block:
        return block_text

    # Build replacement map: for each region, compute what to insert
    replacements: list[tuple[int, int, str]] = []  # (abs_start, abs_end, replacement_text)
    for mstart, mend in regions_in_block:
        # Look up LaTeX from formula_text_map
        latex = None
        for fs_start, fs_latex in formula_text_map.items():
            if mstart <= fs_start < mend and fs_latex:
                latex = fs_latex
                break

        if latex:
            replacements.append((mstart, mend, f"${_sanitize_for_katex(latex)}$"))
        else:
            # No LaTeX — wrap Unicode math symbols in $...$
            raw_text = block_text[mstart - block_start:mend - block_start]
            cleaned = _clean_unicode_math(raw_text)
            replacements.append((mstart, mend, f"${_sanitize_for_katex(cleaned)}$"))

    # Sort replacements by start position (reverse to build from end)
    replacements.sort(key=lambda x: x[0])

    # Build output by splicing replacements into block_text
    result: list[str] = []
    prev = block_start
    for abs_start, abs_end, replacement in replacements:
        rel_start = abs_start - block_start
        rel_prev = prev - block_start
        if rel_start > rel_prev:
            result.append(block_text[rel_prev:rel_start])
        result.append(replacement)
        prev = abs_end
    # Append remaining text after last replacement
    rel_prev = prev - block_start
    if rel_prev < len(block_text):
        result.append(block_text[rel_prev:])

    return "".join(result)


def _already_has_list_marker(text: str) -> bool:
    """Check if text already starts with a list number/bullet prefix."""
    stripped = text.strip()
    # "1.", "2.", "1)", "(1)", "[1]"
    if re.match(r'^[\(\[]?[\d]+[\.\)\]\s]', stripped):
        return True
    # "(1) " or "(2) "
    if re.match(r'^\([\d]+\)\s', stripped):
        return True
    # "(a) ", "(b) ", "(i) " — parenthesized letter/roman numeral
    if re.match(r'^\([a-z]\)\s', stripped):
        return True
    # Roman numerals: "i.", "ii.", "iv.", etc.
    if re.match(r'^[ivxlcdm]+[\.\)]\s', stripped, re.IGNORECASE):
        return True
    # Letter bullets: "a.", "b.", "a) "
    if re.match(r'^[a-z][\.\)]\s', stripped):
        return True
    return False


def _starts_structural_block(text: str) -> bool:
    """Check if text starts with a structural marker that breaks a list group.

    Returns True if the text begins with a heading (#), list prefix (1., (a),
    -), Example/Definition marker, or other structural signal — indicating
    it's NOT continuation content within a list.
    """
    stripped = text.strip()
    if not stripped:
        return True
    # Markdown heading
    if stripped.startswith('#'):
        return True
    # Already a list marker
    if _already_has_list_marker(stripped):
        return True
    # Markdown bullet
    if stripped.startswith('- ') or stripped.startswith('* '):
        return True
    # Example/Definition/Remark/Note/Theorem headings
    if re.match(r'^Example\s+\d+', stripped, re.IGNORECASE):
        return True
    if re.match(r'^(Definition|Remark|Note|Theorem|Lemma|Corollary|Proposition)\s*\d*', stripped, re.IGNORECASE):
        return True
    return False


def _indent_lines(text: str, indent: str, first_line_prefix: str = "") -> str:
    """Apply indentation to each line of text, with optional prefix on first line.

    Ensures multi-line list item text stays visually nested on every line,
    not just the first line.
    """
    lines = text.split('\n')
    result: list[str] = []
    for i, line in enumerate(lines):
        if i == 0:
            result.append(indent + first_line_prefix + line)
        else:
            result.append(indent + line)
    return '\n'.join(result)


def _collapse_line_wraps(text: str, collapse_paragraphs: bool = False) -> str:
    """Collapse single \\n (PDF line wraps) to spaces within text.

    PDF line breaks like "especially\\nprobability theory" are layout artifacts,
    not semantic breaks. Collapsing them produces natural flowing text.

    Args:
        collapse_paragraphs: If True, convert \\n\\n paragraph breaks to \\n
            (tight line breaks) instead of preserving them as \\n\\n gaps.
            Used for grouped list content where paragraph gaps create
            unwanted visual spacing between formula/description lines.
            Real structure (like formulas on separate lines) is preserved
            as single line breaks, not merged into flowing text.
    """
    if '\n' not in text:
        return text
    # Split on paragraph breaks, collapse line wraps within each paragraph
    paragraphs = text.split('\n\n')
    collapsed = []
    for para in paragraphs:
        collapsed.append(para.replace('\n', ' '))
    if collapse_paragraphs:
        # Rejoin with \n (tight line break) — preserves structure
        # (formula/description on separate lines) but avoids \n\n gaps
        return '\n'.join(collapsed)
    else:
        # Preserve paragraph breaks as \n\n
        return '\n\n'.join(collapsed)


# Patterns that should be treated as unordered list items regardless of LLM label
_EXAMPLE_ITEM_PATTERN = re.compile(
    r'^Example\s+\d+[:\.\s]|'
    r'^Definition[:\.\s]|'
    r'^Remark[:\.\s]|'
    r'^Note[:\.\s]|'
    r'^Theorem\s*\d*[:\.\s]|'
    r'^Lemma\s*\d*[:\.\s]|'
    r'^Corollary\s*\d*[:\.\s]|'
    r'^Proposition\s*\d*[:\.\s]',
    re.IGNORECASE,
)

# Sub-item markers that typically appear at nesting >= 2 in academic documents
_SUB_ITEM_PATTERN = re.compile(
    r'^\([a-z]\)\s|'       # (a), (b), (c)
    r'^[ivxlcdm]+[\.\)]\s', # i., ii., iii., iv.
    re.IGNORECASE,
)


def _normalize_block_labels(blocks: list[dict]) -> list[dict]:
    """Normalize block labels and nesting levels for consistency.

    Three corrections:
    1. Example/Definition patterns → always unordered_list_item
    2. Sub-item markers (i., ii., iii., (a), (b), (c)) at low nesting
       → bump nesting based on nearest preceding higher-level list item
    3. Sub-item markers at nesting=1 preceded by a mid-level list item
       → inherit nesting = preceding.nesting + 1
    """
    for i, block in enumerate(blocks):
        stripped = block["text"].strip()

        # --- Fix 1: Normalize Example/Definition labels ---
        if _EXAMPLE_ITEM_PATTERN.match(stripped):
            nesting = 1
            for j in range(i - 1, -1, -1):
                prev = blocks[j]
                if prev["label"] in (StructuralLabel.ORDERED_LIST_ITEM,
                                      StructuralLabel.UNORDERED_LIST_ITEM):
                    nesting = prev.get("nesting_level", 1)
                    break
            block["label"] = StructuralLabel.UNORDERED_LIST_ITEM
            block["nesting_level"] = nesting

        # --- Fix 2: Bump nesting for under-labeled sub-items ---
        # i., ii., iii. and (a), (b), (c) at nesting_level=1 are almost
        # always wrong in academic documents — they're sub-items under
        # numbered lists (1., 2., 3.) or lettered lists, not top-level.
        # Only fix nesting=1; nesting=2+ is likely already correct.
        if (block["label"] in (StructuralLabel.ORDERED_LIST_ITEM,
                                StructuralLabel.UNORDERED_LIST_ITEM)
            and block.get("nesting_level", 0) == 1
            and _SUB_ITEM_PATTERN.match(stripped)):
            # Scan backwards for nearest preceding list item
            for j in range(i - 1, -1, -1):
                prev = blocks[j]
                if prev["label"] in (StructuralLabel.ORDERED_LIST_ITEM,
                                      StructuralLabel.UNORDERED_LIST_ITEM):
                    prev_nesting = prev.get("nesting_level", 1)
                    block["nesting_level"] = prev_nesting + 1
                    break

    return blocks


def _format_block(block: dict, list_counter: dict[int, int],
                  formula_text_map: dict[int, str] | None = None) -> str:
    """Format a single block into markdown."""
    label = block["label"]
    text = block["text"]
    nesting = block["nesting_level"]

    # Clean whitespace within block
    text = text.strip()
    if not text:
        return ""

    # Heading
    if label in HEADING_LABELS:
        prefix = _HEADING_PREFIX.get(label, "")
        return f"\n\n{prefix}{text}\n"

    # Ordered list — always use markdown numbering for proper rendering.
    # Custom markers (a), i., ii. etc. are kept in the text content.
    if label == StructuralLabel.ORDERED_LIST_ITEM:
        # Markdown sub-lists need 3-space indent per nesting level
        # (aligns with parent content, not the marker)
        indent = "   " * max(0, nesting - 1)
        idx = list_counter.get(nesting, 1)
        list_counter[nesting] = idx + 1
        # Clean deeper counters
        for k in list(list_counter.keys()):
            if k > nesting:
                del list_counter[k]
        return f"\n{indent}{idx}. {_hard_breaks(text)}"

    # Unordered list
    if label == StructuralLabel.UNORDERED_LIST_ITEM:
        indent = "   " * max(0, nesting - 1)
        return f"\n{indent}- {_hard_breaks(text)}"

    # Blockquote
    if label == StructuralLabel.BLOCKQUOTE:
        lines = text.split('\n')
        quoted = '\n'.join(f"> {line}" for line in lines if line.strip())
        return f"\n\n{quoted}\n"

    # Code block
    if label == StructuralLabel.CODE_BLOCK:
        return f"\n\n```\n{text}\n```\n"

    # Display math — ONLY use $$ when OCR produced valid LaTeX
    if label == StructuralLabel.DISPLAY_MATH:
        latex = _find_formula_latex(block["char_start"], block["char_end"], formula_text_map)
        if latex:
            return f"\n\n$$\n{_sanitize_for_katex(latex)}\n$$"
        # No valid OCR LaTeX — output as regular text with paragraph break
        return f"\n\n{_hard_breaks(_clean_unicode_math(text))}"

    # Default: paragraph — preserve PDF line breaks as markdown hard breaks
    return f"\n\n{_hard_breaks(text)}"


def _hard_breaks(text: str) -> str:
    """Convert single \\n to hard breaks, preserve \\n\\n as paragraph breaks.

    PDF line breaks are deliberate layout decisions. Single \\n (inter-line)
    gets the markdown hard-break marker (two spaces + \\n). Double \\n
    (inter-block paragraph break) stays as \\n\\n so markdown renders it
    as a proper paragraph gap.
    """
    if '\n' not in text:
        return text
    # Preserve \n\n as paragraph breaks — split on them first
    paragraphs = text.split('\n\n')
    processed = []
    for para in paragraphs:
        if '\n' in para:
            lines = para.split('\n')
            processed.append('  \n'.join(lines))
        else:
            processed.append(para)
    return '\n\n'.join(processed)


_KATEX_SYMBOL_MAP = {
    '∅': '\\emptyset',
    'Ω': '\\Omega',
    'σ': '\\sigma',
    'α': '\\alpha',
    'β': '\\beta',
    '∪': '\\cup',
    '∩': '\\cap',
    '⊆': '\\subseteq',
    '∈': '\\in',
    '∉': '\\notin',
    '⊂': '\\subset',
    '⊃': '\\supset',
    '⊇': '\\supseteq',
    '×': '\\times',
    '→': '\\rightarrow',
    '⇒': '\\Rightarrow',
    '∀': '\\forall',
    '∃': '\\exists',
    '¬': '\\neg',
    '∞': '\\infty',
}


def _sanitize_for_katex(text: str) -> str:
    """Replace Unicode math symbols with LaTeX names for KaTeX rendering.

    KaTeX can render LaTeX commands like \\Omega, \\emptyset, but does not
    recognize bare Unicode symbols like Ω, ∅ in math mode. This function
    converts those symbols to their LaTeX equivalents.

    Does NOT escape braces — that would break LaTeX commands like \\mathcal{F}.
    Braces in set notation should already be escaped as \\{ and \\} in the
    OCR output. If they're bare in span text, KaTeX will eat them, but that's
    better than breaking proper LaTeX commands.
    """
    for sym, latex in _KATEX_SYMBOL_MAP.items():
        text = text.replace(sym, latex)
    return text


def _clean_unicode_math(text: str) -> str:
    """Light cleanup for inline math text WITHOUT KaTeX wrapping.

    When OCR didn't produce valid LaTeX, we keep Unicode math symbols as-is
    (Ω, σ, ∅ render correctly in modern browsers without KaTeX). We only
    fix spacing and remove obvious OCR artifacts.
    """
    text = text.strip()
    # Collapse multiple spaces
    text = re.sub(r'  +', ' ', text)
    return text


def _find_formula_latex(block_start: int, block_end: int,
                        formula_text_map: dict[int, str] | None) -> str | None:
    """Look up OCR-derived LaTeX for a math block by checking formula char_starts."""
    if not formula_text_map:
        return None
    # Check if any formula span starts within this block
    for fs_start, latex in formula_text_map.items():
        if block_start <= fs_start < block_end and latex:
            return latex
    return None


def _escape_list_trigger(text: str) -> str:
    """Escape leading N. pattern (like 1., 2.) to prevent markdown list parsing.

    Nested list structures are formatted as a single text block with hard breaks
    and indentation, not as separate markdown list items.  Escaping the top-level
    number prevents marked.js from incorrectly splitting the block into list items.
    """
    return re.sub(r'^(\d+)\.', r'\1\\.', text)


def merge_annotations(
    text: str,
    metadata_markers: dict[int, list[Marker]],
    llm_annotations: list[SentenceAnnotation],
    formula_spans: list[LabeledSpan] | None = None,
) -> str:
    """Merge all annotations into final Markdown text.

    Nested ordered list items (a)(b)(c) and i.ii.iii. are formatted as a single
    continuous text block with hard line breaks and indentation — like the original
    document layout.  This avoids markdown list syntax which breaks rendering of
    custom markers.  Other block types (headings, paragraphs, math, code) use
    standard markdown formatting.
    """
    if formula_spans is None:
        formula_spans = []

    if not text:
        return ""

    # Build formula LaTeX lookup map
    formula_text_map = _build_formula_text_map(formula_spans)

    # Build character-level label map and inline math regions
    char_labels, global_math_regions = _build_char_labels(text, llm_annotations, formula_spans)

    # Extract blocks (inline MATH absorbed into surrounding blocks)
    blocks = _extract_blocks(text, char_labels, llm_annotations, global_math_regions)

    # Normalize Example/Definition labels for consistency
    blocks = _normalize_block_labels(blocks)

    # Format blocks — consecutive ordered_list_item blocks are grouped into
    # one continuous text block with hard breaks and indentation.
    output_parts: list[str] = []
    block_idx = 0

    while block_idx < len(blocks):
        block = blocks[block_idx]

        if block["label"] in (StructuralLabel.ORDERED_LIST_ITEM, StructuralLabel.UNORDERED_LIST_ITEM):
            # Collect all consecutive list items (both ordered and unordered)
            # into one group — mixed hierarchies like (a)(b)(c) + Examples
            # must stay together to preserve visual nesting.
            # Also include adjacent PARAGRAPH/DISPLAY_MATH blocks that are
            # continuation content of a list item (e.g., formulas or
            # continuation text under "Example 1:" that the LLM labeled
            # as separate blocks).
            group_lines: list[str] = []
            current_nesting = block.get("nesting_level", 1)
            j = block_idx
            while j < len(blocks):
                j_block = blocks[j]
                j_label = j_block["label"]

                # Core list items — always include
                if j_label in (StructuralLabel.ORDERED_LIST_ITEM, StructuralLabel.UNORDERED_LIST_ITEM):
                    j_text = _apply_all_inline(
                        j_block["text"], j_block["char_start"],
                        j_block["label"], metadata_markers,
                        j_block.get("math_regions", []),
                        formula_text_map,
                    )
                    j_nesting = j_block.get("nesting_level", 0)
                    j_indent = "  " * max(0, j_nesting - 1)
                    # Collapse PDF line wraps within the item text (all breaks for grouped content)
                    stripped = _collapse_line_wraps(j_text, collapse_paragraphs=True).strip()
                    if j_label == StructuralLabel.UNORDERED_LIST_ITEM:
                        if not _already_has_list_marker(stripped) and not stripped.startswith("- "):
                            group_lines.append(_indent_lines(stripped, j_indent, "- "))
                        else:
                            group_lines.append(_indent_lines(stripped, j_indent))
                    else:
                        group_lines.append(_indent_lines(stripped, j_indent))
                    current_nesting = j_nesting
                    j += 1
                    continue

                # Continuation content: PARAGRAPH or DISPLAY_MATH that
                # appears right after a list item and doesn't start with
                # a structural marker (heading, list prefix, etc.)
                # Include it with the same indentation as the preceding item
                # so formulas and continuation text stay visually nested.
                if j_label in (StructuralLabel.PARAGRAPH, StructuralLabel.DISPLAY_MATH):
                    j_text = _apply_all_inline(
                        j_block["text"], j_block["char_start"],
                        j_block["label"], metadata_markers,
                        j_block.get("math_regions", []),
                        formula_text_map,
                    )
                    # Collapse PDF line wraps for continuation text too (all breaks for grouped content)
                    stripped = _collapse_line_wraps(j_text, collapse_paragraphs=True).strip()

                    # Don't include if it starts with a heading or list marker
                    # (those are structural breaks, not continuation)
                    if _starts_structural_block(stripped):
                        break

                    # Include as continuation text at the same indent level
                    cont_indent = "  " * max(0, current_nesting - 1)

                    if j_label == StructuralLabel.DISPLAY_MATH:
                        latex = _find_formula_latex(j_block["char_start"], j_block["char_end"], formula_text_map)
                        if latex:
                            group_lines.append(cont_indent + "$$ " + _sanitize_for_katex(latex) + " $$")
                        else:
                            group_lines.append(cont_indent + _clean_unicode_math(stripped))
                    else:
                        group_lines.append(cont_indent + stripped)
                    j += 1
                    continue

                # Any other block type (heading, blockquote, code_block) breaks the group
                break

            # Assemble into one continuous text block with \n line breaks
            assembled = "\n".join(group_lines)
            # Escape leading N. triggers so marked.js doesn't parse as list
            assembled = _escape_list_trigger(assembled)
            # Convert all \n to hard breaks (  \n) for markdown rendering
            assembled = _hard_breaks(assembled)
            output_parts.append(f"\n\n{assembled}")

            block_idx = j  # skip past all the grouped blocks
        else:
            # Apply all inline formatting (bold/italic + math) for non-list blocks
            block_text = _apply_all_inline(
                block["text"], block["char_start"],
                block["label"], metadata_markers,
                block.get("math_regions", []),
                formula_text_map,
            )
            # Collapse PDF line wraps for paragraph blocks —
            # produces flowing text instead of hard-break per PDF line.
            # \n→space is a 1:1 replacement so positions stay valid.
            if block["label"] == StructuralLabel.PARAGRAPH:
                block_text = _collapse_line_wraps(block_text)
            block["text"] = block_text

            list_counter: dict[int, int] = {}
            formatted = _format_block(block, list_counter, formula_text_map)
            output_parts.append(formatted)
            block_idx += 1

    result = "".join(output_parts)

    # Post-process: normalize whitespace
    result = _normalize_whitespace(result)

    # Post-process: fix intra-span math spacing where union/intersection
    # operators are glued to braces without a space (e.g. ∪{ → ∪ {)
    result = _fix_math_operator_spacing(result)

    # Post-process: clean up $...$ wrapping — remove leading/trailing spaces
    # inside $ delimiters and fix LaTeX command spacing
    result = _clean_inline_math_spacing(result)

    # Post-process: add space between closing $ and following letter/digit
    # When math regions are trimmed, characters that were adjacent to the
    # symbol become directly after $, e.g. "$\in$S" → "$\in$ S"
    # (this is for characters OUTSIDE $...$, not inside)
    result = re.sub(r'\$([^$]+)\$([a-zA-Z0-9])', r'$\1$ \2', result)

    # Trim leading/trailing whitespace
    result = result.strip()

    return result


def _fix_merged_spacing(md: str) -> str:
    """Fix spacing artifacts from italic/bold marker suppression.

    When italic markers are removed, spaces that were at marker boundaries
    can be lost, creating concatenated words like "Itrepresents" or "isyear".
    This function re-inserts spaces where two English words were joined.
    """
    # Pattern: lowercase letter directly followed by an uppercase or
    # another word start within a longer word (camel-case-like artifact)
    # e.g. "Itrepresents" → "It represents", "isyear" → "is year"
    # But NOT "CST" or "AI" (legitimate abbreviations)
    md = re.sub(
        r'(?<=[a-z])(?=[A-Z][a-z])',
        ' ',
        md
    )
    # Pattern: common word boundary loss — short word glued to longer word
    # e.g. "basicproperties" → "basic properties"
    # Check by seeing if splitting creates two common English patterns
    md = re.sub(
        r'\b([a-z]{2,5})([a-z]{4,})\b',
        lambda m: f"{m.group(1)} {m.group(2)}" if _looks_like_two_words(m.group(1), m.group(2)) else m.group(0),
        md
    )
    return md


def _looks_like_two_words(prefix: str, suffix: str) -> bool:
    """Check if prefix+suffix looks like two English words glued together."""
    # Short common English words that often get glued
    common_prefixes = {
        'is', 'it', 'in', 'of', 'on', 'to', 'be', 'we', 'he', 'an', 'as',
        'or', 'so', 'no', 'do', 'if', 'by', 'up', 'am', 'me', 'my',
        'the', 'and', 'for', 'but', 'not', 'all', 'any', 'can', 'had',
        'was', 'are', 'has', 'its', 'our', 'who', 'how', 'out',
    }
    return prefix.lower() in common_prefixes


def _fix_math_operator_spacing(md: str) -> str:
    """Insert spaces where union/intersection operators are glued to braces.

    In PDF spans, ∪{ and ∩{ appear as one chunk without a space, but in
    readable math notation these should be ∪ { and ∩ { (e.g. {a} ∪ {b}).
    Only fixes the operator+brace pattern — other cases like ΩX or |Ω|
    are valid math notation without spaces.
    """
    md = md.replace('∪{', '∪ {')
    md = md.replace('∩{', '∩ {')
    return md


def _clean_inline_math_spacing(md: str) -> str:
    """Remove leading/trailing spaces inside $...$ delimiters and fix
    LaTeX command spacing.

    Fixes:
    - "$ \\emptyset $" -> "$\\emptyset$" (strip whitespace inside delimiters)
    - "$\\inS$" -> "$\\in S$" (space between LaTeX command and letter)
    - "$\\Omega$X" -> "$\\Omega$ X" (space after closing delimiter)

    Preserves spaces that are part of the expression (e.g. "$\\alpha, \\beta$")

    Processes by explicitly pairing opening/closing $ delimiters instead
    of using regex, to prevent cross-expression matching that would strip
    spaces between adjacent $...$ expressions.
    """
    # Build known LaTeX command set from our mapping
    from .formula_extractor import UNICODE_TO_LATEX
    known_cmds = sorted(
        {v.lstrip('\\') for v in UNICODE_TO_LATEX.values()},
        key=len, reverse=True  # longest first for greedy matching
    )

    # Find and pair $ delimiters: $...$ expressions
    # Walk through the string, tracking opening $ positions
    result: list[str] = []
    i = 0
    while i < len(md):
        if md[i] == '$':
            # Look for the matching closing $
            j = i + 1
            while j < len(md):
                if md[j] == '$':
                    # Found closing $ — this is a $...$ expression
                    content = md[i + 1:j]
                    # Strip leading/trailing whitespace
                    content = content.strip()
                    # Fix LaTeX command spacing: add space between a
                    # known command and a directly following letter
                    # (e.g. "\inS" → "\in S") so KaTeX can parse them.
                    # Only add space before UPPERCASE letters to avoid
                    # prefix conflicts: \subseteq won't be split by the
                    # \subset regex because "eq" is lowercase, while
                    # actual variable letters (S, A, X) are uppercase.
                    for cmd in known_cmds:
                        content = re.sub(
                            rf'\\{cmd}([A-Z])',
                            lambda m, c=cmd: '\\' + c + ' ' + m.group(1),
                            content,
                        )
                    result.append('$')
                    result.append(content)
                    result.append('$')
                    i = j + 1
                    break
                j += 1
            else:
                # No closing $ found — output as-is
                result.append(md[i])
                i += 1
        else:
            result.append(md[i])
            i += 1
    return ''.join(result)


def _normalize_whitespace(md: str) -> str:
    """Normalize markdown whitespace.

    Preserves hard-break markers (two trailing spaces on a line) which are
    needed for nested list structures rendered as continuous text blocks.
    """
    # Collapse 3+ newlines to 2
    md = re.sub(r'\n{3,}', '\n\n', md)
    # Remove trailing whitespace per line, but preserve hard-break markers
    # (2+ trailing spaces = intentional hard line break in markdown)
    lines = md.split('\n')
    normalized = []
    for line in lines:
        trailing_len = len(line) - len(line.rstrip())
        stripped = line.rstrip()
        if trailing_len >= 2:
            # Preserve hard break marker (exactly 2 trailing spaces)
            normalized.append(stripped + '  ')
        else:
            normalized.append(stripped)
    md = '\n'.join(normalized)
    # Remove leading newlines
    md = md.lstrip('\n')
    return md