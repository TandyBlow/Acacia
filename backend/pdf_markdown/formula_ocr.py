"""
OCR/image pipeline for formula extraction: pix2text lazy singleton,
LaTeX-validity heuristics, crop-and-OCR, and PDF page rendering with fitz.
"""

from __future__ import annotations

import io
import logging
import re

logger = logging.getLogger(__name__)


def _render_page_image(file_path: str, page_num: int, dpi: int = 300) -> tuple[bytes, float, float]:
    """Render a single PDF page to PNG bytes. Returns (bytes, width_px, height_px)."""
    import fitz
    doc = fitz.open(file_path)
    try:
        page = doc[page_num]
        pix = page.get_pixmap(dpi=dpi)
        return pix.tobytes(output="png"), pix.width, pix.height
    finally:
        doc.close()


_p2t_instance: object | None = None


def _get_pix2text():
    """Lazy-load Pix2Text singleton. Downloads models on first run."""
    global _p2t_instance
    if _p2t_instance is None:
        from pix2text import Pix2Text
        logger.info("Loading Pix2Text models...")
        _p2t_instance = Pix2Text(device="cpu")
    return _p2t_instance


def _is_valid_latex(text: str) -> bool:
    """Check if OCR output looks like valid LaTeX, not garbled nonsense.

    Pix2text sometimes produces complete garbage for crop regions that aren't
    actually formulas. This check filters those out before they get injected
    into the output as $$...$$ blocks.
    """
    if not text or len(text.strip()) < 2:
        return False
    stripped = text.strip()

    # Heuristic 1: consonant clusters of 3+ chars indicate garbled OCR
    # e.g. "LllI", "CUll", "lllp", "lldh", "sslgm"
    consonant_runs = re.findall(r'[bcdfghjklmnpqrstvwxyz]{3,}', stripped, re.IGNORECASE)
    if len(consonant_runs) >= 3:
        return False

    # Heuristic 2: check that recognized LaTeX commands dominate the text
    # If text has a few LaTeX commands but is mostly garbled, reject it
    latex_commands = [
        '\\frac', '\\sqrt', '\\sum', '\\int', '\\prod',
        '\\left', '\\right', '\\begin', '\\end',
        '\\emptyset', '\\Omega', '\\sigma', '\\alpha', '\\beta',
        '\\{', '\\}', '\\cup', '\\cap', '\\in',
        '\\subseteq', '\\subset', '\\forall', '\\exists',
        '\\infty', '\\neg', '\\rightarrow', '\\Rightarrow',
        '\\mathcal', '\\text', '\\mathrm',
    ]
    has_latex = any(cmd in stripped for cmd in latex_commands)

    # If there are LaTeX commands, verify they're not embedded in garbled text
    if has_latex:
        # Remove all LaTeX commands and check if remaining text is clean
        clean = stripped
        for cmd in latex_commands:
            clean = clean.replace(cmd, '')
        # Remaining text shouldn't have consonant clusters ≥3 OR too many ≥2 clusters
        remaining_runs = re.findall(r'[bcdfghjklmnpqrstvwxyz]{3,}', clean, re.IGNORECASE)
        if len(remaining_runs) >= 2:
            return False
        # Also check for many short consonant clusters (garbled OCR pattern)
        short_runs = re.findall(r'[bcdfghjklmnpqrstvwxyz]{2}', clean, re.IGNORECASE)
        total_chars_remaining = len(clean.strip())
        if total_chars_remaining > 10 and len(short_runs) / max(total_chars_remaining / 3, 1) > 0.6:
            return False
        # LaTeX without math operators + many remaining tokens = garbled text
        has_operators_check = bool(re.search(r'[=+\-≤≥≠∈∪∩⊆⊃×÷^]', stripped))
        clean_tokens = [t for t in clean.split() if len(t.strip()) > 1]
        if not has_operators_check and len(clean_tokens) >= 5:
            return False

    # Heuristic 3: suspicious CJK content in a "formula"
    cjk_chars = sum(1 for c in stripped if 0x4E00 <= ord(c) <= 0x9FFF)
    if cjk_chars / max(len(stripped), 1) > 0.15:
        return False

    # Heuristic 4: valid expressions have math operators
    has_operators = bool(re.search(r'[=+\-≤≥≠∈∪∩⊆⊃×÷^]', stripped))

    # If it has LaTeX commands or math operators, it's likely valid
    if has_latex or has_operators:
        return True

    # Very long result without any LaTeX or operators is suspicious
    if len(stripped) > 60:
        return False

    # Short results must still look like math — reject plain text or garbled fragments
    # "U 11 1 1 1" or "N ni TEN lonica" are not formulas
    has_greek = bool(re.search(r'[Ωωσαβγδεφψθπλμ]', stripped))
    has_set_notation = bool(re.search(r'[∅∈∉⊂⊃∪∩]', stripped))
    # has_latex / has_operators already returned True above; from here only
    # Greek or set-notation marks a short fragment as a valid formula.
    return bool(has_greek or has_set_notation)


def _crop_and_ocr(
    img_bytes: bytes,
    crop_bbox: tuple[int, int, int, int],
) -> str | None:
    """Crop a region from the page image and run pix2text on it.

    Returns LaTeX string or None. Uses a module-level singleton to avoid
    reloading models on every call.
    """
    try:
        p2t = _get_pix2text()
    except ImportError:
        return None
    except Exception as e:
        logger.warning(f"Failed to load pix2text: {e}")
        return None

    from PIL import Image

    try:
        img = Image.open(io.BytesIO(img_bytes))
        cropped = img.crop(crop_bbox)
        if cropped.width < 5 or cropped.height < 5:
            return None
    except Exception as e:
        logger.warning("Image crop/extract failed for formula region: %s", e)
        return None

    try:
        result = p2t.recognize_text_formula(cropped, return_text=True)
        latex = result if isinstance(result, str) else str(result)
        if not _is_valid_latex(latex):
            logger.info("OCR output rejected (garbled): %s", latex[:80])
            return None
        return latex
    except Exception as e:
        logger.warning("p2t recognize_text_formula failed, falling back to recognize: %s", e)
        try:
            result = p2t.recognize(cropped)
            latex = result.to_markdown() if hasattr(result, 'to_markdown') else str(result)
            if not _is_valid_latex(latex):
                logger.info("OCR fallback rejected (garbled): %s", latex[:80])
                return None
            return latex
        except Exception as e2:
            logger.warning("p2t recognize fallback also failed: %s", e2)
            return None
