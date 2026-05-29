"""
File parser module for extracting text content from various file formats.
Supports: .txt, .md, .pdf, .docx, .ipynb, .py
"""
import json
import os
import re
from pathlib import Path


def parse_txt(file_path: str) -> str:
    """Parse plain text file."""
    with open(file_path, 'r', encoding='utf-8') as f:
        return f.read()


def parse_markdown(file_path: str) -> str:
    """Parse Markdown file."""
    with open(file_path, 'r', encoding='utf-8') as f:
        return f.read()


def _clean_pdf_text(text: str) -> str:
    """Post-process extracted PDF text to improve readability.

    Fixes common artifacts:
    - Merge mid-paragraph line breaks (Chinese text)
    - Remove page numbers and running headers/footers
    - Normalize whitespace
    - Collapse excessive blank lines
    """
    if not text or not text.strip():
        return ""

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


def parse_ipynb(file_path: str) -> str:
    """Parse Jupyter notebook and extract text from all cells."""
    with open(file_path, 'r', encoding='utf-8') as f:
        notebook = json.load(f)

    parts: list[str] = []
    for cell in notebook.get('cells', []):
        source = ''.join(cell.get('source', []))
        cell_type = cell.get('cell_type', 'code')

        if cell_type == 'markdown':
            parts.append(source)
        elif cell_type == 'code':
            parts.append(f'```python\n{source}\n```')

    return '\n\n'.join(parts)


def parse_docx(file_path: str) -> str:
    """Parse Word .docx file and extract text from all paragraphs."""
    try:
        from docx import Document
    except ImportError:
        raise ImportError(
            "python-docx is required for DOCX parsing. Install it with: pip install python-docx"
        )

    doc = Document(file_path)
    paragraphs: list[str] = []

    for para in doc.paragraphs:
        text = para.text
        if text.strip():
            # Preserve heading styles with markdown-like prefix
            if para.style.name.startswith('Heading'):
                level = int(para.style.name.split()[-1]) if para.style.name.split()[-1].isdigit() else 1
                paragraphs.append('#' * min(level, 6) + ' ' + text)
            else:
                paragraphs.append(text)

    # Also extract text from tables
    for table in doc.tables:
        for row in table.rows:
            row_text = '\t'.join(cell.text for cell in row.cells)
            if row_text.strip():
                paragraphs.append(row_text)

    return '\n\n'.join(paragraphs)


def parse_file(file_path: str) -> str:
    """
    Parse file based on extension and return text content.

    Args:
        file_path: Path to the file

    Returns:
        Extracted text content

    Raises:
        ValueError: If file type is not supported
        FileNotFoundError: If file does not exist
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    file_ext = Path(file_path).suffix.lower()

    parsers = {
        '.txt': parse_txt,
        '.md': parse_markdown,
        '.pdf': parse_pdf,
        '.docx': parse_docx,
        '.ipynb': parse_ipynb,
        '.py': parse_txt,
    }

    parser = parsers.get(file_ext)
    if not parser:
        raise ValueError(f"Unsupported file type: {file_ext}. Supported types: {', '.join(parsers.keys())}")

    return parser(file_path)


def is_scanned_pdf(file_path: str) -> bool:
    """Check if a PDF appears to be scanned (image-based, needs OCR).

    Returns True if text extraction yields very little text relative to page count,
    suggesting the PDF contains mostly images rather than embedded text.
    """
    try:
        import fitz
    except ImportError:
        return False

    doc = fitz.open(file_path)
    try:
        page_count = len(doc)
        total_chars = 0
        for page in doc:
            total_chars += len(page.get_text("text").strip())

        # If average chars per page is very low, likely a scanned PDF
        avg_chars = total_chars / max(page_count, 1)
        return avg_chars < 50
    finally:
        doc.close()


def get_file_info(file_path: str) -> dict:
    """Get basic file information."""
    stat = os.stat(file_path)
    return {
        'name': os.path.basename(file_path),
        'size': stat.st_size,
        'extension': Path(file_path).suffix.lower(),
    }
