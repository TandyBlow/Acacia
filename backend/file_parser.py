"""
File parser module for extracting text content from various file formats.
Supports: .txt, .md, .pdf, .docx, .ipynb, .py
"""
from parser_text import (
    parse_txt,
    parse_markdown,
    sanitize_control_chars,
    is_text_garbled,
)
from parser_pdf import (
    parse_pdf,
    _clean_pdf_text,
    extract_pdf_images,
)
from parser_pdf_spans import (
    _is_mono_font,
    _is_bullet_start,
    _format_spans,
    extract_spans_from_pdf,
)
from parser_pdf_markdown import parse_pdf_markdown
from parser_docx import parse_docx
from parser_ipynb import parse_ipynb
from parser_meta import parse_file, get_file_info
