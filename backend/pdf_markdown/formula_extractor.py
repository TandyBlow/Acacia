"""
Formula extraction from PDF page images using pix2text + TexTeller.

Uses Unicode symbol density to detect candidate formula regions, crops just
those small patches from rendered page images, and feeds only the crops to
pix2text. TexTeller serves as fallback for low-confidence outputs.

This is MUCH faster than running pix2text on full pages (milliseconds per
crop vs tens of seconds per page).
"""

from __future__ import annotations

import io
import logging
import re
from collections import defaultdict

from .annotation_schema import StructuralLabel, LabeledSpan
from .span_extractor import Span

logger = logging.getLogger(__name__)

MATH_UNICODE_RANGES = [
    (0x2200, 0x22FF),   # Mathematical Operators
    (0x27C0, 0x27EF),   # Misc Math Symbols-A
    (0x2980, 0x29FF),   # Misc Math Symbols-B
    (0x2A00, 0x2AFF),   # Supplemental Math Operators
    (0x1D400, 0x1D7FF), # Mathematical Alphanumeric Symbols
    (0x2100, 0x214F),   # Letterlike Symbols
    (0x2308, 0x230B),   # Ceiling/floor brackets
]

GREEK_RANGE = (0x0370, 0x03FF)
INTEGRAL_CHARS = set('∫∬∭∮∯∰∱∲∳')
SUM_PROD_CHARS = set('∑∏∐')
MATH_OPERATORS = set('∂∇∞∈∉∋∌∏∐∑−∓∔∕∖∗∘∙√∛∜∝∞∟∠∡∢∣∤∥∦∧∨∩∪∴∵∶∷∸∹∺∻∼∽∾∿≀≁≂≃≄≅≆≇≈≉≊≋≌≍≎≏≐≑≒≓≔≕≖≗≘≙≚≛≜≝≞≟≠≡≢≣≤≥≦≧≨≩≪≫≬≭≮≯≰≱≲≳≴≵≶≷≸≹≺≻≼≽≾≿⊀⊃⊂⊄⊅⊆⊇⊈⊉⊊⊋⊌⊍⊎⊏⊐⊑⊒⊓⊔⊕⊖⊗⊘⊙⊚⊛⊜⊝⊞⊟⊢⊣⊤⊥⊦⊨⊩⊪⊫⊬⊭⊮⊯⊰⊱⊲⊳⊴⊵⊶⊷⊸⊹⊺⊻⊼⊽⊾⊿⋀⋁⋂⋃⋄⋅⋆⋇⋈⋉⋊⋋⋌⋍⋎⋏⋐⋑⋒⋓⋔⋕⋖⋗⋘⋙⋚⋛⋜⋝⋞⋟')


def _char_in_ranges(ch: str, ranges: list[tuple[int, int]]) -> bool:
    cp = ord(ch)
    return any(lo <= cp <= hi for lo, hi in ranges)

# Unicode → LaTeX mapping for inline math symbols
UNICODE_TO_LATEX = {
    'Ω': r'\Omega', 'Ω': r'\Omega',  # U+03A9 and U+2126
    'ω': r'\omega',
    'σ': r'\sigma', 'Σ': r'\Sigma',
    '∅': r'\emptyset', '∈': r'\in', '∉': r'\notin',
    '∪': r'\cup', '∩': r'\cap', '⊆': r'\subseteq',
    '⊂': r'\subset', '⊇': r'\supseteq', '⊃': r'\supset',
    '∀': r'\forall', '∃': r'\exists',
    '∂': r'\partial', '∇': r'\nabla',
    '∞': r'\infty', '∝': r'\propto',
    '≤': r'\leq', '≥': r'\geq', '≠': r'\neq',
    '≈': r'\approx', '≡': r'\equiv',
    '×': r'\times', '÷': r'\div',
    '±': r'\pm', '∓': r'\mp',
    '→': r'\rightarrow', '←': r'\leftarrow',
    '⇒': r'\Rightarrow', '⇐': r'\Leftarrow',
    '⇔': r'\Leftrightarrow',
    '∧': r'\wedge', '∨': r'\vee',
    '¬': r'\neg',
    '√': r'\sqrt',
    'α': r'\alpha', 'β': r'\beta', 'γ': r'\gamma',
    'δ': r'\delta', 'ε': r'\epsilon', 'ζ': r'\zeta',
    'η': r'\eta', 'θ': r'\theta', 'λ': r'\lambda',
    'μ': r'\mu', 'π': r'\pi', 'φ': r'\phi',
    'ψ': r'\psi', 'τ': r'\tau',
    'Γ': r'\Gamma', 'Δ': r'\Delta', 'Θ': r'\Theta',
    'Λ': r'\Lambda', 'Φ': r'\Phi', 'Ψ': r'\Psi',
    '∑': r'\sum', '∏': r'\prod', '∫': r'\int',
    '∎': r'\blacksquare',
}

def unicode_to_latex(text: str) -> str:
    """Replace Unicode math symbols with LaTeX equivalents."""
    result = []
    for ch in text:
        if ch in UNICODE_TO_LATEX:
            result.append(UNICODE_TO_LATEX[ch])
        else:
            result.append(ch)
    return ''.join(result)


def math_symbol_density(text: str) -> float:
    """Ratio of math-unicode characters to total non-whitespace characters."""
    if not text:
        return 0.0
    math_count = 0
    letter_count = 0
    for ch in text:
        if ch.isspace():
            continue
        letter_count += 1
        if _char_in_ranges(ch, MATH_UNICODE_RANGES):
            math_count += 1
        elif _char_in_ranges(ch, [GREEK_RANGE]):
            math_count += 1
        elif ch in INTEGRAL_CHARS or ch in SUM_PROD_CHARS or ch in MATH_OPERATORS:
            math_count += 1
    if letter_count == 0:
        return 0.0
    return math_count / letter_count


def detect_math_regions(
    spans: list[Span],
    density_threshold: float = 0.01,
    min_region_len: int = 1,
) -> list[tuple[int, int, float, list[Span]]]:
    """Find character ranges likely containing math based on Unicode density.

    Returns list of (char_start, char_end, density, matching_spans).

    Lower thresholds (0.01 density, min 1 char) to detect inline math
    symbols like Ω, σ, ∅ that appear as single-character spans.
    Adjacent math spans are merged into formula clusters.
    """
    if not spans:
        return []

    regions: list[tuple[int, int, float, list[Span]]] = []
    i = 0
    while i < len(spans):
        span = spans[i]
        density = math_symbol_density(span.text)
        if density >= density_threshold and len(span.text.strip()) >= min_region_len:
            region_spans = [span]
            start = span.char_start
            end = span.char_end
            densities = [density]
            last_accepted_idx = i
            j = i + 1
            while j < len(spans):
                next_density = math_symbol_density(spans[j].text)
                # Gap text only from spans between last_accepted and current candidate
                gap_text = "".join(s.text for s in spans[last_accepted_idx + 1:j])
                if next_density >= density_threshold:
                    region_spans.append(spans[j])
                    end = spans[j].char_end
                    densities.append(next_density)
                    last_accepted_idx = j
                    j += 1
                elif (j + 1 < len(spans) and
                      len(gap_text.strip()) <= 20 and
                      math_symbol_density(spans[j + 1].text) >= density_threshold):
                    # Bridge a small gap between two math spans
                    region_spans.append(spans[j])
                    region_spans.append(spans[j + 1])
                    end = spans[j + 1].char_end
                    last_accepted_idx = j + 1
                    j += 2
                else:
                    break
            avg_density = sum(densities) / len(densities)
            regions.append((start, end, avg_density, region_spans))
            i = j
        else:
            i += 1

    return regions


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


def _get_span_bbox_in_pixels(
    spans: list[Span],
    page_height_px: float,
    dpi: int = 300,
    margin: int = 10,
) -> tuple[int, int, int, int] | None:
    """Convert span bounding boxes (PDF points) to pixel crop region with margin.

    Returns (x0, y0, x1, y1) in pixel coordinates, or None if spans have no bbox.
    """
    if not spans:
        return None

    scale = dpi / 72.0
    x0 = min(s.bbox[0] for s in spans if s.bbox[2] > s.bbox[0])
    y0 = min(s.bbox[1] for s in spans if s.bbox[3] > s.bbox[1])
    x1 = max(s.bbox[2] for s in spans)
    y1 = max(s.bbox[3] for s in spans)

    if x1 <= x0 or y1 <= y0:
        return None

    px0 = max(0, int(x0 * scale) - margin)
    py1 = int((page_height_px - y0 * scale)) + margin  # flip Y
    px1 = int(x1 * scale) + margin
    py0 = max(0, int((page_height_px - y1 * scale)) - margin)

    return (px0, py0, px1, py1)


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
    has_math_content = bool(re.search(r'[=+\-≤≥≠∈∪∩⊆⊃×÷^]', stripped))
    has_greek = bool(re.search(r'[Ωωσαβγδεφψθπλμ]', stripped))
    has_set_notation = bool(re.search(r'[∅∈∉⊂⊃∪∩]', stripped))
    # Has LaTeX commands (checked earlier)
    if not (has_math_content or has_greek or has_set_notation or has_latex):
        return False


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


def extract_formulas(
    file_path: str,
    spans: list[Span],
    confidence_threshold: float = 0.7,
    max_ocr_regions: int = 15,
) -> list[LabeledSpan]:
    """Extract formulas by detecting candidate regions and cropping.

    1. Detect math regions via Unicode symbol density
    2. Classify as inline (MATH) or display (DISPLAY_MATH) by width
    3. Only OCR display-math candidates — inline math uses span text directly
    4. Mark remaining regions as MATH with density-based confidence
    5. Filter by confidence_threshold

    OCR is the slowest stage (~5s per crop). Skipping inline math saves
    most of the time — a page with 56 regions typically has <5 display
    formulas but 50+ inline variables that don't need OCR.
    """
    # Step 1: Detect candidate regions
    math_regions = detect_math_regions(spans)

    if not math_regions:
        logger.info("No math regions detected")
        return []

    # Group regions by page
    by_page: dict[int, list] = defaultdict(list)
    for start, end, density, region_spans in math_regions:
        page = region_spans[0].page_number
        by_page[page].append((start, end, density, region_spans))

    # Cache rendered page images
    page_images: dict[int, tuple[bytes, float, float]] = {}

    labeled: list[LabeledSpan] = []

    for page_num, regions in sorted(by_page.items()):
        # Lazy render page
        if page_num not in page_images:
            try:
                page_images[page_num] = _render_page_image(file_path, page_num)
            except Exception as e:
                logger.warning(f"Failed to render page {page_num}: {e}")
                # Fall back to density-only labels
                for start, end, density, _ in regions:
                    labeled.append(LabeledSpan(
                        label=StructuralLabel.MATH,
                        char_start=start,
                        char_end=end,
                        confidence=density,
                    ))
                continue

        img_bytes, page_w, page_h = page_images[page_num]

        # Classify regions: only OCR display-math candidates
        ocr_count = 0
        for start, end, density, region_spans in regions:
            # Determine if this region is display math (wide) or inline (narrow)
            crop_bbox = _get_span_bbox_in_pixels(region_spans, page_h)
            if crop_bbox is None:
                labeled.append(LabeledSpan(
                    label=StructuralLabel.MATH,
                    char_start=start,
                    char_end=end,
                    confidence=density,
                ))
                continue

            crop_w = crop_bbox[2] - crop_bbox[0]
            is_display = crop_w > page_w * 0.4

            if is_display and ocr_count < max_ocr_regions:
                # OCR only display-math candidates
                latex = _crop_and_ocr(img_bytes, crop_bbox)
                ocr_count += 1

                if latex and latex.strip():
                    labeled.append(LabeledSpan(
                        label=StructuralLabel.DISPLAY_MATH,
                        char_start=start,
                        char_end=end,
                        confidence=0.7,
                        latex_text=latex.strip(),
                    ))
                else:
                    # OCR failed or produced garbage — don't label as math,
                    # let text flow as regular paragraph instead
                    logger.info(f"Skipping display-math label for region [{start}:{end}] (no valid OCR)")
            else:
                # Inline math — use Unicode-to-LaTeX mapping instead of OCR
                raw_text = "".join(s.text for s in region_spans)
                latex_text = unicode_to_latex(raw_text)
                # Check if mapping produced any LaTeX (vs just plain text)
                has_latex = any(ch in UNICODE_TO_LATEX for ch in raw_text)
                confidence = max(density, 0.8) if has_latex else density
                if has_latex:
                    labeled.append(LabeledSpan(
                        label=StructuralLabel.MATH,
                        char_start=start,
                        char_end=end,
                        confidence=confidence,
                        latex_text=latex_text,
                    ))
                else:
                    # No LaTeX mapping available — keep as regular text, don't label
                    pass

        logger.info(f"Page {page_num + 1}: OCR'd {ocr_count} display formulas, "
                    f"skipped {len(regions) - ocr_count} inline regions")

    # Filter by confidence threshold
    labeled = [f for f in labeled if f.confidence >= confidence_threshold]

    labeled.sort(key=lambda f: f.char_start)
    logger.info(f"Total math regions: {len(labeled)} (after confidence filter)")
    return labeled