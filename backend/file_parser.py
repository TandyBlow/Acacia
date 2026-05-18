"""
File parser module for extracting text content from various file formats.
Supports: .txt, .md, .pdf, .ipynb
"""
import json
import os
from pathlib import Path


def parse_txt(file_path: str) -> str:
    """Parse plain text file."""
    with open(file_path, 'r', encoding='utf-8') as f:
        return f.read()


def parse_markdown(file_path: str) -> str:
    """Parse Markdown file."""
    with open(file_path, 'r', encoding='utf-8') as f:
        return f.read()


def parse_pdf(file_path: str) -> str:
    """Parse PDF file and extract text content."""
    try:
        import PyPDF2

        text_content = []
        with open(file_path, 'rb') as f:
            pdf_reader = PyPDF2.PdfReader(f)
            for page in pdf_reader.pages:
                text = page.extract_text()
                if text:
                    text_content.append(text)

        return '\n\n'.join(text_content)
    except ImportError:
        raise ImportError("PyPDF2 is required for PDF parsing. Install it with: pip install PyPDF2")


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
        '.ipynb': parse_ipynb,
    }

    parser = parsers.get(file_ext)
    if not parser:
        raise ValueError(f"Unsupported file type: {file_ext}. Supported types: {', '.join(parsers.keys())}")

    return parser(file_path)


def get_file_info(file_path: str) -> dict:
    """Get basic file information."""
    stat = os.stat(file_path)
    return {
        'name': os.path.basename(file_path),
        'size': stat.st_size,
        'extension': Path(file_path).suffix.lower(),
    }
