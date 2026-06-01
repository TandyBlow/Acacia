"""
PDF Markdown extraction pipeline with LLM structural annotation.

Usage:
    from pdf_markdown import FullPipeline

    pipeline = FullPipeline("document.pdf")
    markdown = pipeline.run()           # synchronous
    # or
    async for event in pipeline.run_streaming():  # streaming via SSE
        ...
"""

from .pipeline import FullPipeline
from .annotation_schema import (
    StructuralLabel,
    LabeledSpan,
    SentenceAnnotation,
    Marker,
    MarkerType,
    RuleViolation,
    SSEMessage,
)

__all__ = [
    "FullPipeline",
    "StructuralLabel",
    "LabeledSpan",
    "SentenceAnnotation",
    "Marker",
    "MarkerType",
    "RuleViolation",
    "SSEMessage",
]
