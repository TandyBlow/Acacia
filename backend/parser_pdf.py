"""
Basic PDF text extraction and PDF-level detection/asset helpers.
"""
import logging
import os
import re

from parser_text import sanitize_control_chars

logger = logging.getLogger(__name__)


def _clean_pdf_text(text: str) -> str:
    """Post-process extracted PDF text to improve readability.

    Fixes common artifacts:
    - Sanitize control characters (ligatures, encoding artifacts)
    - Merge mid-paragraph line breaks (Chinese text)
    - Remove page numbers and running headers/footers
    - Normalize whitespace
    - Collapse excessive blank lines
    """
    if not text or not text.strip():
        return ""

    # Sanitize control characters FIRST — downstream processing and
    # the frontend markdown parser both break on invalid characters.
    text = sanitize_control_chars(text)

    # Remove common header/footer patterns: standalone page numbers,
    # repeated running headers (e.g. "Chapter 1  Introduction" on every page)
    lines = text.split('\n')
    cleaned: list[str] = []

    for line in lines:
        stripped = line.strip()
        # Skip standalone page numbers
        if re.match(r'^\d{1,4}$', stripped):
            continue
        # Skip lines that are just "第X页" or similar
        if re.match(r'^第[一二三四五六七八九十\d]+页$', stripped):
            continue
        cleaned.append(line)

    text = '\n'.join(cleaned)

    # Merge broken Chinese lines:
    # A line that doesn't end with a sentence-ending char or punctuation
    # and the next line starts with a Chinese char -> merge them
    text = re.sub(
        r'(?<=[^\n。！？；：，、"—…》\)\s])\n(?=[一-鿿㐀-䶿])',
        '',
        text
    )

    # Merge lines ending with hyphen (English word break across lines)
    text = re.sub(r'-\n(?=[a-zA-Z])', '', text)

    # Normalize whitespace: collapse 3+ newlines into double newline (paragraph break)
    text = re.sub(r'\n{3,}', '\n\n', text)

    # Remove excessive spaces within lines
    text = re.sub(r'[ \t]{2,}', ' ', text)

    return text.strip()


def parse_pdf(file_path: str) -> str:
    """Parse PDF file and extract text content using pymupdf.

    Falls back gracefully: if text extraction yields very little text,
    the caller can detect this and route to OCR.
    """
    try:
        import fitz  # pymupdf
    except ImportError:
        raise ImportError(
            "pymupdf is required for PDF parsing. Install it with: pip install pymupdf"
        )

    text_pages: list[str] = []
    doc = fitz.open(file_path)

    try:
        for page in doc:
            # Use "text" mode for best plain-text extraction with layout awareness
            text = page.get_text("text")
            if text and text.strip():
                text_pages.append(text.strip())
    finally:
        doc.close()

    raw_text = '\n\n'.join(text_pages)
    return _clean_pdf_text(raw_text)


def extract_pdf_images(file_path: str, output_dir: str) -> list[dict]:
    """Extract embedded images from a PDF and save them to output_dir.

    Returns a list of dicts with keys: index, page, width, height, filename.
    Images are saved as PNG files named page{N}_img{M}.png.
    """
    import fitz

    os.makedirs(output_dir, exist_ok=True)
    images: list[dict] = []
    doc = fitz.open(file_path)
    try:
        img_index = 0
        for page_num in range(len(doc)):
            page = doc[page_num]
            for img in page.get_images(full=True):
                xref = img[0]
                try:
                    base = doc.extract_image(xref)
                except Exception as e:
                    logger.warning("Failed to extract image xref=%s: %s", xref, e)
                    continue
                img_bytes = base.get("image")
                if not img_bytes:
                    continue
                ext = base.get("ext", "png")
                filename = f"page{page_num}_img{img_index}.{ext}"
                filepath = os.path.join(output_dir, filename)
                with open(filepath, "wb") as f:
                    f.write(img_bytes)
                images.append({
                    "index": img_index,
                    "page": page_num,
                    "width": base.get("width", 0),
                    "height": base.get("height", 0),
                    "filename": filename,
                })
                img_index += 1
        return images
    finally:
        doc.close()
