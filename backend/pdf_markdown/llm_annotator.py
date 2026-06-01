"""
LLM-based structural annotation for PDF text.

Sends sentence chunks to the LLM for structural labeling. The LLM outputs
character-position labels; it never generates or modifies text content.
"""

from __future__ import annotations

import json
import logging
import os
import re
import time

import httpx

from .annotation_schema import (
    StructuralLabel,
    LabeledSpan,
    SentenceAnnotation,
)

logger = logging.getLogger(__name__)

LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.deepseek.com")
LLM_MODEL = os.getenv("LLM_MODEL", "deepseek-chat")
LLM_TIMEOUT = 60.0
MAX_RETRIES = 3
BASE_DELAY = 1.0


ANNOTATION_SYSTEM_PROMPT = """You are a document structure annotator. Your task is to label character ranges in text with structural types.

CRITICAL RULE: You MUST NOT generate, modify, rephrase, or create any text. You ONLY output character position ranges that point to EXISTING text in the input. Think of yourself as a highlighter pen — you mark what's already there.

## Labels you can assign:

- **heading_1**: Document title (usually just one)
- **heading_2**: Major section heading
- **heading_3**: Sub-section heading
- **heading_4**: Sub-sub-section heading
- **ordered_list_item**: Part of a numbered/lettered list (1., 2., a., b., i., ii., etc.)
- **unordered_list_item**: Part of a bulleted list (•, -, * items)
- **blockquote**: Quoted or specially highlighted text
- **math**: Inline mathematical expression that should be wrapped in $...$. This includes single variables when used in mathematical context (e.g., "S" in "a set S is in F")
- **display_math**: Block-level displayed equation that should be wrapped in $$...$$
- **code_block**: Monospace code listing
- **paragraph**: Normal body text (default type)

## Rules:

1. Every visible text character must belong to exactly ONE label. Use "paragraph" as the default.
2. char_start is INCLUSIVE, char_end is EXCLUSIVE. The range must exactly match the input text.
3. For headings: level must be consistent. No skipping levels (h2→h4 without h3 is invalid). The heading label should cover the heading TEXT only, NOT the leading whitespace or trailing newline.
4. For ordered_list_item: nesting_level starts at 1. Sub-items get level 2, 3, etc. The label MUST cover the entire item INCLUDING the bullet/number prefix (e.g., "(a) Sample space Ω" is one label, not split into "(a)" + "Sample space Ω"). This ensures the prefix is preserved in the output.
5. For unordered_list_item: same nesting rule as ordered.
6. For math: ANY mathematical expression including single-letter variables in context (e.g., "S" in mathematical discussion), operators, Greek letters, formulas. Override italic for math variables — label them math not paragraph.
7. For display_math: large centered equations, multi-line derivations, anything that stands alone as a formula block.
8. Short standalone lines that look like titles should be headings (check content, not length).
9. Sentences that are purely punctuation or whitespace can be omitted from the output.
10. Nested ordered lists (like "(a)", "(b)" under a numbered item) are separate list items with higher nesting_level.

## NESTED LIST DETECTION — CRITICAL:

Many academic documents use hierarchical list structures like:

1. Probability space
   (a) Sample space Ω
   (b) Event
   (c) σ-algebra F

Or:

(a) Sample space Ω:
    i. all BNBU students
    ii. in a medical diagnosis
    iii. we assume Ω to be finite

In these cases:
- The top-level numbered items (1., 2., etc.) are ordered_list_item with nesting_level=1
- Lettered sub-items ((a), (b), (c)) are ordered_list_item with nesting_level=2
- Roman numeral sub-items (i., ii., iii.) are ordered_list_item with nesting_level=3

EACH sub-item MUST be labeled as its own ordered_list_item range, NOT merged into a paragraph. For example, "(a) Sample space Ω" should be one ordered_list_item (nesting=2) that INCLUDES the "(a)" prefix, "i. all BNBU students" should be a separate ordered_list_item (nesting=3) that INCLUDES the "i." prefix, etc.

NEVER label nested list items as "paragraph" — always use ordered_list_item with the correct nesting_level.

## EXAMPLE ITEMS IN LIST HIERARCHIES — CRITICAL:

Academic documents often include "Example 1:", "Example 2:", "Definition:", etc. within list hierarchies. These are NOT standalone paragraphs — they belong to the parent list structure and must be labeled as list items with the correct nesting.

For example, in this structure:

  (c) σ-algebra F on sample space:
    i. The empty set ∅ is in F
    ii. The union of any set in F is also in F
    iii. If a set S is in F, the complement Sc is also in F
    Example 1: rolling a six-sided dice...
    Example 2: consider a sample space Ω= {a, b, c}...

The "Example 1" and "Example 2" items should be labeled as unordered_list_item with nesting_level=3 (same depth as i., ii., iii.), NOT as paragraph.

Similarly, "Definition:", "Remark:", "Note:" items inside list hierarchies should be labeled as unordered_list_item at the same nesting level as their sibling list items.

NEVER label "Example N:", "Definition:", "Remark:", or "Note:" items as "paragraph" when they appear within a list structure.

## Output JSON format:
{
  "sentences": [
    {
      "sentence_id": <int>,
      "char_start": <int>,
      "char_end": <int>,
      "labels": [
        {
          "label": "<one of the label types above>",
          "char_start": <int>,
          "char_end": <int>,
          "nesting_level": <int>,
          "confidence": <float 0.0-1.0>
        }
      ]
    }
  ]
}

OUTPUT ONLY VALID JSON. No markdown fences, no explanations, no other text."""


def _format_chunk_for_llm(segments) -> str:
    """Format a chunk of segments as numbered text with character positions."""
    lines: list[str] = []
    for seg in segments:
        lines.append(f"[S{seg.sentence_id} | chars {seg.char_start}-{seg.char_end}]")
        # Show context if present
        if seg.context_before:
            lines.append(f"  context_before: {repr(seg.context_before[:200])}")
        lines.append(f"  text: {repr(seg.text)}")
        if seg.context_after:
            lines.append(f"  context_after: {repr(seg.context_after[:200])}")
        lines.append("")
    return "\n".join(lines)


def _parse_llm_json(raw: str) -> dict | None:
    """Parse LLM response as JSON with fallback strategies."""
    # Strategy 1: direct parse
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    # Strategy 2: extract from markdown code fence
    fence_match = re.search(r'```(?:json)?\s*\n?(.*?)\n?```', raw, re.DOTALL)
    if fence_match:
        try:
            return json.loads(fence_match.group(1))
        except json.JSONDecodeError:
            pass

    # Strategy 3: find outermost { } pair
    start = raw.find('{')
    end = raw.rfind('}')
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(raw[start:end + 1])
        except json.JSONDecodeError:
            pass

    return None


def _validate_annotation(
    sent: SentenceAnnotation,
    full_text: str,
) -> SentenceAnnotation:
    """Validate and fix annotation positions against the actual text.

    Discards labels whose char_start/char_end don't match the text content.
    Falls back to 'paragraph' for invalid labels.
    """
    validated: list[LabeledSpan] = []

    for label in sent.labels:
        if label.char_start < 0 or label.char_end > len(full_text):
            logger.warning(
                f"S{sent.sentence_id}: label {label.label.value} "
                f"[{label.char_start}:{label.char_end}] out of bounds, discarding"
            )
            continue
        if label.char_start >= label.char_end:
            logger.warning(
                f"S{sent.sentence_id}: label {label.label.value} has empty range, discarding"
            )
            continue

        # Verify text slice exists
        sliced = full_text[label.char_start:label.char_end]
        if not sliced.strip():
            logger.warning(
                f"S{sent.sentence_id}: label {label.label.value} covers only whitespace, discarding"
            )
            continue

        validated.append(label)

    if not validated:
        # Fall back to paragraph for the sentence range
        validated.append(LabeledSpan(
            label=StructuralLabel.PARAGRAPH,
            char_start=sent.char_start,
            char_end=sent.char_end,
            confidence=0.0,
        ))

    sent.labels = validated
    return sent


def call_llm_with_retry(
    messages: list[dict],
    max_retries: int = MAX_RETRIES,
    base_delay: float = BASE_DELAY,
    json_mode: bool = True,
) -> str:
    """Call LLM with exponential backoff. Raises RuntimeError on exhaustion."""
    if not LLM_API_KEY:
        raise RuntimeError("LLM_API_KEY environment variable is not set")

    headers = {
        "Authorization": f"Bearer {LLM_API_KEY}",
        "Content-Type": "application/json",
    }
    payload: dict = {
        "model": LLM_MODEL,
        "messages": messages,
        "temperature": 0.3,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}

    last_error: Exception | None = None

    for attempt in range(max_retries):
        try:
            with httpx.Client(timeout=httpx.Timeout(10.0, read=LLM_TIMEOUT)) as client:
                resp = client.post(
                    f"{LLM_BASE_URL}/v1/chat/completions",
                    headers=headers,
                    json=payload,
                )
                resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"]
        except (httpx.HTTPStatusError, httpx.RequestError, httpx.TimeoutException, ValueError) as e:
            last_error = e
            if attempt == max_retries - 1:
                raise RuntimeError(
                    f"LLM call failed after {max_retries} retries: {last_error}"
                ) from last_error
            # Fast bail: if connection-level error (SSL, DNS, refused),
            # don't waste time retrying — server is likely down
            if isinstance(e, httpx.ConnectError):
                raise RuntimeError(
                    f"LLM server unreachable, aborting: {e}"
                ) from e
            delay = base_delay * (2 ** attempt)
            logger.warning(
                f"LLM call failed (attempt {attempt + 1}/{max_retries}), "
                f"retrying in {delay:.1f}s: {e}"
            )
            time.sleep(delay)

    raise RuntimeError(f"LLM call failed: {last_error}")


def annotate_chunk(
    segments,
    full_text: str,
) -> list[SentenceAnnotation]:
    """Send a chunk of segments to the LLM for structural annotation.

    Args:
        segments: List of Segment objects to annotate.
        full_text: The complete document text (for position validation).

    Returns:
        List of SentenceAnnotation objects with validated labels.
    """
    if not segments:
        return []

    formatted = _format_chunk_for_llm(segments)

    user_prompt = (
        "Annotate the following document text with structural labels.\n"
        "Each segment is shown with its absolute character position range and surrounding context.\n"
        "Label the TEXT content only, excluding bullet markers, number prefixes, and leading whitespace from label ranges.\n\n"
        + formatted
    )

    messages = [
        {"role": "system", "content": ANNOTATION_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]

    raw = call_llm_with_retry(messages)
    parsed = _parse_llm_json(raw)

    if parsed is None:
        logger.error(f"Failed to parse LLM JSON response: {raw[:500]}")
        # Fall back: all sentences are paragraphs
        return [
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
            for seg in segments
        ]

    annotations: list[SentenceAnnotation] = []
    raw_sentences = parsed.get("sentences", [])
    if not raw_sentences:
        raw_sentences = parsed.get("annotations", [])

    for raw_sent in raw_sentences:
        labels: list[LabeledSpan] = []
        for raw_label in raw_sent.get("labels", []):
            label_str = raw_label.get("label", "paragraph")
            try:
                label_type = StructuralLabel(label_str)
            except ValueError:
                logger.warning(f"Unknown label '{label_str}', defaulting to paragraph")
                label_type = StructuralLabel.PARAGRAPH

            labels.append(LabeledSpan(
                label=label_type,
                char_start=raw_label.get("char_start", 0),
                char_end=raw_label.get("char_end", 0),
                nesting_level=raw_label.get("nesting_level", 0),
                confidence=raw_label.get("confidence", 0.8),
            ))

        sent = SentenceAnnotation(
            sentence_id=raw_sent.get("sentence_id", 0),
            char_start=raw_sent.get("char_start", 0),
            char_end=raw_sent.get("char_end", 0),
            labels=labels,
        )
        sent = _validate_annotation(sent, full_text)
        annotations.append(sent)

    return annotations


def annotate_document(
    segments,
    full_text: str,
    chunk_size: int = 50,
    overlap: int = 3,
) -> list[SentenceAnnotation]:
    """Annotate a full document, splitting into chunks for the LLM.

    Handles cross-chunk coordination: for overlapping segments, prefers
    the annotation from the chunk where the segment is centered.
    """
    if not segments:
        return []

    from .text_segmenter import chunk_segments
    chunks = chunk_segments(segments, chunk_size=chunk_size, overlap=overlap)

    all_annotations: dict[int, list[SentenceAnnotation]] = {}

    for chunk_idx, chunk in enumerate(chunks):
        logger.info(f"Annotating chunk {chunk_idx + 1}/{len(chunks)} ({len(chunk)} sentences)")
        try:
            chunk_annotations = annotate_chunk(chunk, full_text)
            all_annotations[chunk_idx] = chunk_annotations
        except RuntimeError as e:
            logger.error(f"Chunk {chunk_idx} annotation failed: {e}")
            # Create paragraph-fallback annotations for this chunk
            all_annotations[chunk_idx] = [
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
                for seg in chunk
            ]

    # Merge: for overlapping sentences, prefer the chunk where the segment is centered
    # Track which chunk produced each annotation so we look up in the correct source chunk
    final: dict[int, SentenceAnnotation] = {}
    chunk_source: dict[int, int] = {}  # sentence_id → chunk_idx that produced the annotation

    for chunk_idx, annotations in all_annotations.items():
        chunk = chunks[chunk_idx]
        chunk_size_actual = len(chunk)
        for sent_ann in annotations:
            sent_id = sent_ann.sentence_id
            position_in_chunk = next(
                (i for i, s in enumerate(chunk) if s.sentence_id == sent_id),
                chunk_size_actual // 2,
            )
            distance_from_edge = min(position_in_chunk, chunk_size_actual - 1 - position_in_chunk)

            if sent_id not in final:
                final[sent_id] = sent_ann
                chunk_source[sent_id] = chunk_idx
            else:
                # Look up existing annotation in its SOURCE chunk (not always chunks[0])
                source_chunk_idx = chunk_source[sent_id]
                source_chunk = chunks[source_chunk_idx]
                source_chunk_size = len(source_chunk)
                existing_pos = next(
                    (i for i, s in enumerate(source_chunk) if s.sentence_id == sent_id),
                    source_chunk_size // 2,
                )
                existing_distance = min(existing_pos, source_chunk_size - 1 - existing_pos)
                if distance_from_edge > existing_distance:
                    final[sent_id] = sent_ann
                    chunk_source[sent_id] = chunk_idx

    return [final[sid] for sid in sorted(final.keys())]
