"""
Pure document-formatting logic (extracted from the legacy parse task flow).

LLM-based Markdown formatting of extracted text: LaTeX math protect/restore,
paragraph-aware text chunking, and the verbatim-preservation predicate.
No task state, no threading; safe to call from any background thread.
"""

import os
import re

import httpx

# ── Formatting prompt & constants ──────────────────────────────────────
_FORMAT_PROMPT = """You are a document formatter. Convert the extracted PDF text into clean Markdown with LaTeX math.

CRITICAL RULES:
1. **Math**: Use $...$ for ALL math, both inline and displayed. NEVER use $$...$$ (block math) because it breaks lists.
   - P(X | Y) → $P(X | Y)$
   - For displayed formulas, put $...$ on its own line:
     $\\displaystyle\\sum_i P(X|Y_i)P(Y_i)$
   - Greek letters: ψ → $\\psi$, δ → $\\delta$
2. **Headings**: Use # ## ### for sections. Numbers like "1.", "2.1" are headings.
3. **Lists**: Use - for bullets, 1. for steps. Preserve sub-numbering (a)(b)(c) as indented list items.
4. **Bold**: Use **term** for key terms.
5. **Do NOT invent**: Only format source text. Fix obvious OCR errors from context.
6. **Preserve ALL content**: every example, formula, step, definition.

Output ONLY valid Markdown, no explanations."""

_CHUNK_SIZE = 8000


_MATH_PATTERNS = [
    re.compile(r"\$\$[\s\S]+?\$\$"),
    re.compile(r"\\\[[\s\S]+?\\\]"),
    re.compile(r"\\\([\s\S]+?\\\)"),
    re.compile(r"\\begin\{([A-Za-z*]+)\}[\s\S]+?\\end\{\1\}"),
    re.compile(r"(?<!\\)\$(?![\s\d])(?:\\.|[^$\\\n])+?(?<!\\)\$"),
]


def should_preserve_verbatim(file_ext: str) -> bool:
    """Return true for formats that are already authored as Markdown."""
    return file_ext.lower() in {".md", ".markdown"}


def _protect_math(text: str) -> tuple[str, dict[str, str]]:
    """Replace LaTeX spans with stable placeholders before LLM formatting."""
    replacements: dict[str, str] = {}
    protected_ranges: list[tuple[int, int]] = []
    matches: list[tuple[int, int, str]] = []

    for pattern in _MATH_PATTERNS:
        for match in pattern.finditer(text):
            start, end = match.span()
            if any(not (end <= a or start >= b) for a, b in protected_ranges):
                continue
            protected_ranges.append((start, end))
            matches.append((start, end, match.group(0)))

    if not matches:
        return text, replacements

    matches.sort(key=lambda item: item[0])
    parts: list[str] = []
    cursor = 0
    for index, (start, end, value) in enumerate(matches):
        placeholder = f"ACACIA_MATH_PLACEHOLDER_{index:04d}"
        replacements[placeholder] = value
        parts.append(text[cursor:start])
        parts.append(placeholder)
        cursor = end
    parts.append(text[cursor:])

    return "".join(parts), replacements


def _restore_math(text: str, replacements: dict[str, str]) -> str:
    """Restore placeholders produced by _protect_math."""
    for placeholder, value in replacements.items():
        text = text.replace(placeholder, value)
        text = text.replace(f"`{placeholder}`", value)
    return text


def _split_text(text: str, size: int) -> list[str]:
    """Split text at paragraph boundaries, keeping chunks under size."""
    paragraphs = text.split('\n\n')
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0
    for para in paragraphs:
        if current_len + len(para) > size and current:
            chunks.append('\n\n'.join(current))
            current = [para]
            current_len = len(para)
        else:
            current.append(para)
            current_len += len(para)
    if current:
        chunks.append('\n\n'.join(current))
    return chunks


def format_document_text(text_content: str, image_urls: list[str] | None = None) -> str:
    """Format raw document text into clean Markdown with LaTeX math.

    Chunks the text, sends each chunk to the LLM, and reassembles.
    Can be called synchronously (from /format-content) or from a background thread.
    """
    api_key = os.getenv("LLM_API_KEY")
    base_url = os.getenv("LLM_BASE_URL", "https://api.deepseek.com")
    model = os.getenv("LLM_MODEL", "deepseek-chat")

    protected_text, math_replacements = _protect_math(text_content)
    chunks = _split_text(protected_text, _CHUNK_SIZE)
    formatted_parts: list[str] = []

    for i, chunk in enumerate(chunks):
        ctx = ""
        if len(chunks) > 1:
            ctx = f"\n(This is part {i + 1} of {len(chunks)}. Format it as a continuous section. Do NOT add a document title — continue from where the previous part left off.)"

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": _FORMAT_PROMPT},
                {"role": "user", "content": chunk + ctx}
            ],
            "temperature": 0.3,
        }
        with httpx.Client(timeout=120.0) as client:
            resp = client.post(
                f"{base_url}/v1/chat/completions",
                headers=headers, json=payload
            )
            resp.raise_for_status()
        data = resp.json()
        formatted_parts.append(data["choices"][0]["message"]["content"])

    formatted = _restore_math('\n\n'.join(formatted_parts), math_replacements)

    if image_urls:
        img_md = '\n\n---\n## Extracted Figures\n\n'
        for j, url in enumerate(image_urls):
            img_md += f'![Figure {j + 1}]({url})\n\n'
        formatted += img_md

    return formatted
