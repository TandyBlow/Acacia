"""
Background file-parse task manager with progress tracking.
Uses in-memory state dict + threading for single-server deployments.

After upload saves the file to disk, parsing runs on a daemon thread.
Frontend polls GET /upload-status/{file_id} for progress.

Stages: saving -> parsing -> ocr_check -> ready (or failed)

After parsing completes, a separate formatting thread converts the raw text
into clean Markdown with LaTeX math, caching it as {file_id}.formatted.txt.
This runs async so the file is "ready" immediately; formatting arrives a few
seconds later. Line-by-line chat picks up the formatted text automatically.
"""

import logging
import os
import re
import threading

import httpx

logger = logging.getLogger(__name__)

_parse_tasks: dict[str, dict] = {}
_lock = threading.Lock()

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


def _run_format_thread(owner_id: str, file_id: str, file_ext: str) -> None:
    """Background thread: read cached text, format it, write .formatted.txt."""
    try:
        cache_dir = f"/tmp/acacia_uploads/{owner_id}"
        txt_path = os.path.join(cache_dir, f"{file_id}.txt")
        fmt_path = os.path.join(cache_dir, f"{file_id}.formatted.txt")

        if not os.path.exists(txt_path):
            return

        with open(txt_path, 'r', encoding='utf-8') as f:
            text_content = f.read()

        if not text_content.strip():
            return

        # Check for extracted images
        img_dir = os.path.join("/tmp/acacia_uploads/images", file_id)
        image_urls: list[str] = []
        if os.path.exists(img_dir):
            image_urls = sorted(
                f"/file-images/{file_id}/{f}"
                for f in os.listdir(img_dir)
            )

        if should_preserve_verbatim(file_ext):
            formatted = text_content
        else:
            formatted = format_document_text(text_content, image_urls)

        with open(fmt_path, 'w', encoding='utf-8') as f:
            f.write(formatted)

        logger.info(f"Background formatting complete for {file_id}: {len(formatted)} chars")

    except Exception as e:
        logger.warning(f"Background formatting failed for {file_id}: {e}")


def enqueue_parse(file_id: str, file_path: str, owner_id: str, file_ext: str,
                  original_filename: str = "") -> None:
    """Start background file parsing. Non-blocking — returns immediately."""
    with _lock:
        _parse_tasks[file_id] = {
            "status": "processing",
            "stage": "parsing",
            "error": "",
            "filename": original_filename,
        }

    thread = threading.Thread(
        target=_run_parse_thread,
        args=(file_id, file_path, owner_id, file_ext),
        daemon=True,
    )
    thread.start()
    logger.info(f"Enqueued background parse for {file_id} ({file_ext}) orig_name={original_filename}")


def get_parse_progress(file_id: str) -> dict | None:
    """Return parse progress dict or None if no task is registered."""
    with _lock:
        return _parse_tasks.get(file_id)


def _run_parse_thread(file_id: str, file_path: str, owner_id: str, file_ext: str) -> None:
    """Background thread: parse file, check OCR for PDFs, write cache."""
    from file_parser import parse_file, get_file_info

    # Read original filename from task state
    with _lock:
        task = _parse_tasks.get(file_id, {})
        original_filename = task.get("filename", "")

    try:
        # Stage 1: parse file
        with _lock:
            if file_id in _parse_tasks:
                _parse_tasks[file_id]["stage"] = "parsing"

        text_content = parse_file(file_path)
        file_info = get_file_info(file_path)

        ocr_status = "not_needed"
        need_ocr_reason = ""
        total_pages = 0

        # Stage 2: OCR check for PDFs
        if file_ext == ".pdf":
            with _lock:
                if file_id in _parse_tasks:
                    _parse_tasks[file_id]["stage"] = "ocr_check"

            from pdf_ocr import needs_ocr, get_page_count

            need_ocr_reason = needs_ocr(file_path)

            if need_ocr_reason:
                from ocr_task_manager import enqueue_ocr

                total_pages = get_page_count(file_path)
                is_garbled = need_ocr_reason == "text_garbled"
                enqueue_ocr(
                    file_id, file_path, owner_id,
                    total_pages=total_pages,
                    is_garbled=is_garbled,
                )
                ocr_status = "pending"
                logger.info(
                    f"Enqueued background OCR for {file_id} "
                    f"(reason={need_ocr_reason}, pages={total_pages})"
                )

        # Write cache
        cache_dir = os.path.dirname(file_path)
        cache_path = os.path.join(cache_dir, f"{file_id}.txt")
        with open(cache_path, "w", encoding="utf-8") as cf:
            cf.write(text_content)

        # Stage 3: ready
        with _lock:
            _parse_tasks[file_id] = {
                "status": "ready",
                "stage": "ready",
                "error": "",
                "result": {
                    "file_id": file_id,
                    "filename": original_filename or os.path.basename(file_path),
                    "size": file_info["size"],
                    "extension": file_info["extension"],
                    "text_length": len(text_content),
                    "text_preview": text_content[:200] + "..." if len(text_content) > 200 else text_content,
                    "ocr_applied": False,
                    "ocr_reason": need_ocr_reason or None,
                    "ocr_status": ocr_status,
                    "total_pages": total_pages,
                },
            }

        logger.info(f"Parse complete for {file_id}: {len(text_content)} chars, ocr={ocr_status}")

        # Spawn async formatting — file is already "ready", this is a bonus
        fmt_thread = threading.Thread(
            target=_run_format_thread,
            args=(owner_id, file_id, file_ext),
            daemon=True,
        )
        fmt_thread.start()

    except Exception as e:
        logger.error(f"Parse failed for {file_id}: {e}")
        # Clean up file on error
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except Exception as e2:
                logger.warning("Failed to clean up temp file %s after parse failure: %s", file_path, e2)
        with _lock:
            _parse_tasks[file_id] = {
                "status": "failed",
                "stage": "failed",
                "error": str(e),
            }
