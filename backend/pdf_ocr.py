"""
OCR pipeline for scanned / image-based PDFs.
Renders PDF pages to images, then runs OCR to extract text.

Supports multiple OCR backends (auto-detected):
- easyocr (recommended, pure Python, good Chinese support)
- tesseract (faster, requires system install of tesseract-ocr)
"""

from __future__ import annotations

import io
import logging
from pathlib import Path
from typing import Callable

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Backend detection
# ---------------------------------------------------------------------------

def _get_easyocr_reader():
    """Lazy-load easyocr Reader. Singleton to avoid reloading models."""
    import easyocr
    return easyocr.Reader(['ch_sim', 'en'], gpu=False, verbose=False)


_easyocr_reader: object | None = None


def _ocr_easyocr(page_images: list[bytes]) -> str:
    """Run easyocr on a list of page images (PNG bytes)."""
    global _easyocr_reader
    if _easyocr_reader is None:
        logger.info("Loading easyocr models (first run downloads ~100MB)...")
        _easyocr_reader = _get_easyocr_reader()

    from PIL import Image

    all_text: list[str] = []
    for i, img_bytes in enumerate(page_images):
        img = Image.open(io.BytesIO(img_bytes))
        results = _easyocr_reader.readtext(img, detail=0)
        page_text = '\n'.join(results)
        if page_text.strip():
            all_text.append(page_text.strip())
        logger.debug(f"easyocr page {i + 1}/{len(page_images)}: {len(page_text)} chars")

    return '\n\n'.join(all_text)


def _ocr_tesseract(page_images: list[bytes], lang: str = 'chi_sim+eng') -> str:
    """Run tesseract OCR on a list of page images."""
    import pytesseract
    from PIL import Image

    all_text: list[str] = []
    for i, img_bytes in enumerate(page_images):
        img = Image.open(io.BytesIO(img_bytes))
        text = pytesseract.image_to_string(img, lang=lang)
        if text.strip():
            all_text.append(text.strip())
        logger.debug(f"tesseract page {i + 1}/{len(page_images)}: {len(text)} chars")

    return '\n\n'.join(all_text)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

# Thresholds for auto-OCR decision
MIN_CHARS_FOR_TEXT_PDF = 100       # fewer than this total -> likely scanned
MIN_AVG_CHARS_PER_PAGE = 50        # fewer than this per page -> likely scanned

# OCR DPI when rendering pages. Higher = better accuracy but slower.
OCR_RENDER_DPI = 200


def _render_pages(file_path: str, dpi: int = OCR_RENDER_DPI) -> list[bytes]:
    """Render all pages of a PDF to PNG images (in-memory bytes)."""
    import fitz

    doc = fitz.open(file_path)
    images: list[bytes] = []
    try:
        for page in doc:
            # Render page to a pixmap at specified DPI
            pix = page.get_pixmap(dpi=dpi)
            images.append(pix.tobytes(output="png"))
    finally:
        doc.close()
    return images


def _detect_available_backend() -> str | None:
    """Return the name of the first available OCR backend, or None."""
    try:
        import easyocr
        return "easyocr"
    except ImportError:
        pass
    try:
        import pytesseract
        pytesseract.get_tesseract_version()
        return "tesseract"
    except Exception:
        pass
    return None


def needs_ocr(file_path: str) -> bool:
    """Check whether a PDF likely needs OCR (scanned/image-based).

    Returns True if text extraction yields very little text relative to
    the number of pages, suggesting the content is image-based.
    """
    import fitz

    doc = fitz.open(file_path)
    try:
        page_count = max(len(doc), 1)
        total_chars = 0
        for page in doc:
            total_chars += len(page.get_text("text").strip())

        if total_chars < MIN_CHARS_FOR_TEXT_PDF:
            return True
        return (total_chars / page_count) < MIN_AVG_CHARS_PER_PAGE
    finally:
        doc.close()


def ocr_pdf(file_path: str, backend: str | None = None, dpi: int = OCR_RENDER_DPI) -> str:
    """Extract text from a scanned/image-based PDF using OCR.

    Args:
        file_path: Path to the PDF file.
        backend: OCR backend name ('easyocr', 'tesseract') or None for auto-detect.
        dpi: Rendering DPI for page images (higher = better accuracy, slower).

    Returns:
        Extracted text content.

    Raises:
        RuntimeError: If no OCR backend is available.
        ImportError: If the specified backend is not installed.
    """
    # Resolve backend
    if backend is None:
        backend = _detect_available_backend()
    if backend is None:
        raise RuntimeError(
            "No OCR backend available. Install one:\n"
            "  pip install easyocr          (recommended, pure Python)\n"
            "  pip install pytesseract       (requires tesseract system install)"
        )

    # Render pages
    logger.info(f"Rendering PDF pages at {dpi} DPI for OCR...")
    page_images = _render_pages(file_path, dpi=dpi)
    if not page_images:
        return ""

    # Run OCR
    backends: dict[str, Callable[[list[bytes]], str]] = {
        "easyocr": _ocr_easyocr,
        "tesseract": _ocr_tesseract,
    }
    ocr_fn = backends.get(backend)
    if ocr_fn is None:
        raise ValueError(f"Unknown OCR backend: {backend}. Options: {list(backends)}")

    logger.info(f"Running OCR with {backend} on {len(page_images)} pages...")
    raw_text = ocr_fn(page_images)
    logger.info(f"OCR complete: {len(raw_text)} chars extracted")

    # Apply the same text cleaning used by the main parser
    from file_parser import _clean_pdf_text
    return _clean_pdf_text(raw_text)
