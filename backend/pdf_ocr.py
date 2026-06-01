"""
OCR pipeline for scanned / image-based PDFs.
Renders PDF pages to images, then runs OCR to extract text.

Supports multiple OCR backends (auto-detected):
- pix2text (recommended, recognizes text + LaTeX formulas + tables)
- easyocr (pure Python, good Chinese support)
- tesseract (faster, requires system install of tesseract-ocr)
"""

from __future__ import annotations

import io
import logging
from pathlib import Path
from typing import Callable

logger = logging.getLogger(__name__)

# ── Suppress noisy ONNX/CUDA warnings ──────────────────────────────────
# pix2text/RapidOCR log WARNINGs about CUDAExecutionProvider being
# unavailable on systems without onnxruntime-gpu. The fallback to CPU
# works fine — these messages only confuse users.

def _suppress_ocr_warnings():
    try:
        import logging as _logging
        _logging.getLogger("rapidocr").setLevel(_logging.ERROR)
        _logging.getLogger("rapidocr_onnxruntime").setLevel(_logging.ERROR)
        _logging.getLogger("cnocr").setLevel(_logging.ERROR)
        _logging.getLogger("cnstd").setLevel(_logging.ERROR)
    except Exception as e:
        logger.debug("Failed to suppress OCR logger levels: %s", e)
    try:
        import warnings as _warnings
        _warnings.filterwarnings("ignore", message=".*CUDAExecutionProvider.*")
    except Exception as e:
        logger.debug("Failed to suppress CUDA warnings: %s", e)

_suppress_ocr_warnings()

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
    total = len(page_images)
    for i, img_bytes in enumerate(page_images):
        img = Image.open(io.BytesIO(img_bytes))
        results = _easyocr_reader.readtext(img, detail=0)
        page_text = '\n'.join(results)
        if page_text.strip():
            all_text.append(page_text.strip())
        if (i + 1) % 5 == 0 or i == total - 1:
            logger.info(f"easyocr page {i + 1}/{total}: {len(page_text)} chars")

    return '\n\n'.join(all_text)


def _ocr_tesseract(page_images: list[bytes], lang: str = 'chi_sim+eng') -> str:
    """Run tesseract OCR on a list of page images."""
    import pytesseract
    from PIL import Image

    all_text: list[str] = []
    total = len(page_images)
    for i, img_bytes in enumerate(page_images):
        img = Image.open(io.BytesIO(img_bytes))
        text = pytesseract.image_to_string(img, lang=lang)
        if text.strip():
            all_text.append(text.strip())
        if (i + 1) % 5 == 0 or i == total - 1:
            logger.info(f"tesseract page {i + 1}/{total}: {len(text)} chars")

    return '\n\n'.join(all_text)


# ── Pix2Text backend (formula-aware OCR) ─────────────────────────────

_pix2text_instance: object | None = None


def _get_pix2text():
    """Lazy-load Pix2Text singleton. Downloads models on first run (~200MB)."""
    from pix2text import Pix2Text
    return Pix2Text(device="cpu")


def _ocr_pix2text(page_images: list[bytes]) -> str:
    """Run Pix2Text on a list of page images.

    P2T recognizes text, LaTeX formulas, and tables, outputting Markdown.
    Formulas are wrapped in $...$ (inline) and $$...$$ (block) delimiters
    that the frontend KaTeX renderer can display.
    """
    global _pix2text_instance
    if _pix2text_instance is None:
        logger.info("Loading Pix2Text models (first run downloads ~200MB)...")
        _pix2text_instance = _get_pix2text()

    from PIL import Image

    all_text: list[str] = []
    total = len(page_images)
    for i, img_bytes in enumerate(page_images):
        img = Image.open(io.BytesIO(img_bytes))
        try:
            result = _pix2text_instance.recognize_text_formula(img, return_text=True)
            page_text = result if isinstance(result, str) else str(result)
        except Exception as e:
            logger.warning("pix2text recognize_text_formula failed, falling back to recognize: %s", e)
            # Fallback: try the full recognize API
            result = _pix2text_instance.recognize(img)
            page_text = result.to_markdown() if hasattr(result, 'to_markdown') else str(result)
        if page_text.strip():
            all_text.append(page_text.strip())
        if (i + 1) % 5 == 0 or i == total - 1:
            logger.info(f"pix2text page {i + 1}/{total}: {len(page_text)} chars")

    return '\n\n'.join(all_text)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

# Thresholds for auto-OCR decision
MIN_CHARS_FOR_TEXT_PDF = 100       # fewer than this total -> likely scanned
MIN_AVG_CHARS_PER_PAGE = 50        # fewer than this per page -> likely scanned

# OCR DPI when rendering pages. Higher = better accuracy but slower.
# 300 is the recommended minimum for Chinese characters (CJK glyphs need
# more detail than Latin letters). 200 produced unacceptably poor results.
OCR_RENDER_DPI = 300


def _render_pages(file_path: str, dpi: int = OCR_RENDER_DPI) -> list[bytes]:
    """Render all pages of a PDF to PNG images (in-memory bytes)."""
    import fitz

    doc = fitz.open(file_path)
    page_count = len(doc)
    images: list[bytes] = []
    try:
        for i, page in enumerate(doc):
            pix = page.get_pixmap(dpi=dpi)
            images.append(pix.tobytes(output="png"))
            if (i + 1) % 5 == 0 or i == page_count - 1:
                logger.info(f"Rendered {i + 1}/{page_count} pages for OCR")
    finally:
        doc.close()
    return images


def get_page_count(file_path: str) -> int:
    """Return the number of pages in a PDF without rendering all of them."""
    import fitz

    doc = fitz.open(file_path)
    try:
        return len(doc)
    finally:
        doc.close()


def _render_page(file_path: str, page_num: int, dpi: int = OCR_RENDER_DPI) -> bytes:
    """Render a single page of a PDF to PNG bytes (in-memory)."""
    import fitz

    doc = fitz.open(file_path)
    try:
        page = doc[page_num]
        pix = page.get_pixmap(dpi=dpi)
        return pix.tobytes(output="png")
    finally:
        doc.close()


def _detect_available_backend() -> str | None:
    """Return the name of the first available OCR backend, or None.

    Priority: pix2text > easyocr > tesseract
    pix2text is preferred because it recognizes LaTeX formulas in addition to text.
    """
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


def needs_ocr(file_path: str) -> str | None:
    """Check whether a PDF needs OCR, and why.

    Returns a reason string if OCR is recommended, or None if the PDF text
    is adequate.  Reasons:
    - "text_too_short": scanned/image-based PDF with very little extractable text
    - "text_garbled": text extraction produced garbled characters (PUA chars,
      C1 control chars, mojibake patterns) that sanitize_control_chars
      CANNOT fix — OCR is the only way to recover readable text

    Ligature control characters (U+001B-U+001F) are NOT considered garbled
    because sanitize_control_chars maps them back to the correct letters.
    Only unfixable degradation (PUA, C1 controls, non-ASCII mojibake)
    triggers the OCR recommendation.
    """
    import fitz

    doc = fitz.open(file_path)
    try:
        page_count = max(len(doc), 1)
        total_chars = 0
        raw_parts: list[str] = []
        for page in doc:
            text = page.get_text("text").strip()
            total_chars += len(text)
            raw_parts.append(text)

        # Check 1: too little text (scanned/image-based PDF)
        if total_chars < MIN_CHARS_FOR_TEXT_PDF:
            return "text_too_short"
        if (total_chars / page_count) < MIN_AVG_CHARS_PER_PAGE:
            return "text_too_short"

        # Check 2: garbled text (font encoding issues).
        # Apply sanitize_control_chars FIRST so that fixable ligature
        # issues (U+001B-U+001F) don't trigger a needless hour-long OCR.
        # Then check the "fixed" text — if it's still garbled (PUA, C1,
        # mojibake), OCR is genuinely needed.
        from file_parser import is_text_garbled, sanitize_control_chars
        raw_text = '\n'.join(raw_parts)
        fixed_text = sanitize_control_chars(raw_text)
        if is_text_garbled(fixed_text):
            return "text_garbled"

        return None
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
        "pix2text": _ocr_pix2text,
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


def extract_formulas_with_bbox(file_path: str) -> list:
    """Extract formula regions from PDF using pix2text + TexTeller cross-validation.

    Thin wrapper around pdf_markdown.formula_extractor.extract_formulas.
    Returns list of LabeledSpan objects with MATH/DISPLAY_MATH labels and
    character positions aligned to PyMuPDF text spans.

    Requires spans from extract_spans_from_pdf() for spatial alignment.
    """
    from pdf_markdown.formula_extractor import extract_formulas
    from pdf_markdown.span_extractor import extract_spans

    spans = extract_spans(file_path)
    if not spans:
        return []
    return extract_formulas(file_path, spans)


def ocr_page(file_path: str, page_num: int, dpi: int = OCR_RENDER_DPI,
             backend: str | None = None) -> str:
    """OCR a single page of a PDF. Returns extracted text for that page.

    Designed for the background OCR task manager to process pages one at a
    time with progress reporting between pages.

    Args:
        file_path: Path to the PDF file.
        page_num: Zero-based page index.
        dpi: Rendering DPI.
        backend: OCR backend name or None for auto-detect.

    Returns:
        Extracted text content for the page (not cleaned — caller should
        accumulate and clean the full result).
    """
    if backend is None:
        backend = _detect_available_backend()
    if backend is None:
        raise RuntimeError("No OCR backend available")

    from PIL import Image

    img_bytes = _render_page(file_path, page_num, dpi)
    img = Image.open(io.BytesIO(img_bytes))

    if backend == "pix2text":
        global _pix2text_instance
        if _pix2text_instance is None:
            logger.info("Loading Pix2Text models (first run downloads ~200MB)...")
            _pix2text_instance = _get_pix2text()
        try:
            result = _pix2text_instance.recognize_text_formula(img, return_text=True)
            return result if isinstance(result, str) else str(result)
        except Exception as e:
            logger.warning("pix2text recognize_text_formula failed in ocr_page, falling back: %s", e)
            result = _pix2text_instance.recognize(img)
            return result.to_markdown() if hasattr(result, 'to_markdown') else str(result)

    elif backend == "easyocr":
        global _easyocr_reader
        if _easyocr_reader is None:
            logger.info("Loading easyocr models (first run downloads ~100MB)...")
            _easyocr_reader = _get_easyocr_reader()
        results = _easyocr_reader.readtext(img, detail=0)
        return '\n'.join(results)

    elif backend == "tesseract":
        import pytesseract
        return pytesseract.image_to_string(img, lang='chi_sim+eng')

    else:
        raise ValueError(f"Unknown OCR backend: {backend}")
