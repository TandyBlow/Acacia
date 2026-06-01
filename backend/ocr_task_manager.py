"""
Background OCR task manager with progress tracking.
Uses in-memory state dict + threading for single-server deployments.

OCR runs on a daemon thread page by page. After each page:
- Progress dict is updated (thread-safe via lock)
- Accumulated text is written to {file_id}.txt cache atomically

Consumers (frontend poll, line-by-line chat) always read the cache file
and get the best available text at any point in time.
"""

import logging
import os
import threading

logger = logging.getLogger(__name__)

# ── In-memory progress state ──────────────────────────────────────────

_ocr_tasks: dict[str, dict] = {}
_lock = threading.Lock()


def enqueue_ocr(file_id: str, file_path: str, owner_id: str,
                total_pages: int, is_garbled: bool = False,
                backend: str | None = None, dpi: int = 300) -> None:
    """Start background OCR on a PDF. Non-blocking — returns immediately.

    Args:
        file_id: Unique file identifier.
        file_path: Path to the PDF on disk.
        owner_id: User ID (for cache directory).
        total_pages: Number of pages in the PDF.
        is_garbled: If True, pymupdf text was garbled — clear cache before OCR.
        backend: OCR backend name or None for auto-detect.
        dpi: Rendering DPI.
    """
    with _lock:
        if file_id in _ocr_tasks and _ocr_tasks[file_id]["status"] in ("running", "pending"):
            return
        _ocr_tasks[file_id] = {
            "status": "pending",
            "total_pages": total_pages,
            "completed_pages": 0,
            "error": "",
            "backend": backend or _detect_backend_name(),
        }

    # If pymupdf produced garbled text, clear the cache so consumers
    # don't see garbage while OCR is running
    if is_garbled:
        cache_dir = os.path.dirname(file_path)
        cache_path = os.path.join(cache_dir, f"{file_id}.txt")
        if os.path.exists(cache_path):
            with open(cache_path, 'w', encoding='utf-8') as f:
                f.write("")

    thread = threading.Thread(
        target=_run_ocr_thread,
        args=(file_id, file_path, owner_id, total_pages, dpi),
        daemon=True,
    )
    thread.start()
    logger.info(f"Enqueued background OCR for {file_id} ({total_pages} pages)")


def get_ocr_progress(file_id: str) -> dict | None:
    """Return OCR progress dict or None if no task is registered."""
    with _lock:
        return _ocr_tasks.get(file_id)


def _detect_backend_name() -> str | None:
    """Lightweight backend detection (no imports)."""
    try:
        import pix2text
        return "pix2text"
    except ImportError:
        pass
    try:
        import easyocr
        return "easyocr"
    except ImportError:
        pass
    try:
        import pytesseract
        pytesseract.get_tesseract_version()
        return "tesseract"
    except Exception as e:
        logger.debug("Tesseract not available: %s", e)
        pass
    return None


def _run_ocr_thread(file_id: str, file_path: str, owner_id: str,
                    total_pages: int, dpi: int) -> None:
    """Background thread: OCR one page at a time, update cache incrementally."""
    from pdf_ocr import ocr_page, _detect_available_backend
    from file_parser import _clean_pdf_text

    backend = _detect_available_backend()
    if not backend:
        with _lock:
            _ocr_tasks[file_id]["status"] = "failed"
            _ocr_tasks[file_id]["error"] = "No OCR backend available"
        return

    with _lock:
        if file_id in _ocr_tasks:
            _ocr_tasks[file_id]["status"] = "running"
            _ocr_tasks[file_id]["backend"] = backend

    cache_dir = os.path.dirname(file_path)
    cache_path = os.path.join(cache_dir, f"{file_id}.txt")
    all_text: list[str] = []

    # Preserve any existing (non-garbled) pymupdf text
    if os.path.exists(cache_path):
        try:
            with open(cache_path, 'r', encoding='utf-8') as f:
                existing = f.read().strip()
            if existing:
                all_text.append(existing)
        except Exception as e:
            logger.warning("Failed to read OCR cache %s: %s", cache_path, e)

    try:
        for page_num in range(total_pages):
            page_text = ocr_page(file_path, page_num, dpi=dpi, backend=backend)
            if page_text and page_text.strip():
                all_text.append(page_text.strip())

            # Update progress after each page
            cleaned = _clean_pdf_text("\n\n".join(all_text))
            with _lock:
                _ocr_tasks[file_id]["completed_pages"] = page_num + 1

            # Atomic write: temp file then rename
            tmp_path = cache_path + ".tmp"
            with open(tmp_path, 'w', encoding='utf-8') as f:
                f.write(cleaned)
            os.replace(tmp_path, cache_path)

            logger.info(
                f"OCR page {page_num + 1}/{total_pages} done for {file_id} "
                f"(backend={backend})"
            )

        with _lock:
            _ocr_tasks[file_id]["status"] = "done"
        logger.info(f"OCR complete for {file_id}: {len(cleaned)} chars")

    except Exception as e:
        logger.error(f"OCR failed for {file_id}: {e}")
        with _lock:
            _ocr_tasks[file_id]["status"] = "failed"
            _ocr_tasks[file_id]["error"] = str(e)
