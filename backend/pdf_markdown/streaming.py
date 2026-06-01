"""
SSE streaming protocol for the PDF markdown extraction pipeline.

Uses server-sent events to stream pipeline progress and sentence-level
annotation results to the frontend. Compatible with vanilla EventSource.
"""

from __future__ import annotations

import json
from typing import AsyncGenerator

from .annotation_schema import SSEMessage


def format_sse(event: SSEMessage) -> str:
    """Format an SSEMessage as an SSE protocol string."""
    data_json = json.dumps(event.data, ensure_ascii=False)
    return f"event: {event.event}\ndata: {data_json}\n\n"


def pipeline_start(file_name: str, page_count: int, total_chars: int) -> SSEMessage:
    return SSEMessage("pipeline_start", {
        "file_name": file_name,
        "page_count": page_count,
        "total_chars": total_chars,
    })


def ocr_progress(page: int, total_pages: int, stage: str = "ocr") -> SSEMessage:
    return SSEMessage("ocr_progress", {
        "stage": stage,
        "page": page,
        "total_pages": total_pages,
    })


def formula_progress(formulas_found: int, review_needed: int = 0, page: int = 0, total_pages: int = 0) -> SSEMessage:
    return SSEMessage("formula_progress", {
        "formulas_found": formulas_found,
        "review_needed": review_needed,
        "page": page,
        "total_pages": total_pages,
    })


def stage_progress(stage: str, detail: str = "", percent: int = 0,
                   stage_ms: int = 0, total_ms: int = 0) -> SSEMessage:
    """Generic stage transition event for detailed progress reporting."""
    return SSEMessage("stage_progress", {
        "stage": stage,
        "detail": detail,
        "percent": percent,
        "stageMs": stage_ms,
        "totalMs": total_ms,
    })


def annotation_progress(sentences_done: int, total_sentences: int) -> SSEMessage:
    return SSEMessage("annotation_progress", {
        "sentences_done": sentences_done,
        "total_sentences": total_sentences,
    })


def sentence_result(
    sentence_id: int,
    markdown_fragment: str,
    plain_text: str,
    labels: list[dict],
) -> SSEMessage:
    return SSEMessage("sentence_result", {
        "sentence_id": sentence_id,
        "markdown_fragment": markdown_fragment,
        "plainText": plain_text,
        "labels": labels,
    })


def review_issue(
    region: tuple[int, int],
    issue: str,
    status: str,
) -> SSEMessage:
    return SSEMessage("review_issue", {
        "region": list(region),
        "issue": issue,
        "status": status,
    })


def pipeline_complete(
    total_markdown_length: int,
    issues_found: int = 0,
    issues_resolved: int = 0,
    unresolved: int = 0,
    final_markdown: str = "",
) -> SSEMessage:
    return SSEMessage("pipeline_complete", {
        "total_markdown_length": total_markdown_length,
        "issues_found": issues_found,
        "issues_resolved": issues_resolved,
        "unresolved": unresolved,
        "final_markdown": final_markdown,
    })


def pipeline_error(stage: str, message: str, recoverable: bool = False) -> SSEMessage:
    return SSEMessage("pipeline_error", {
        "stage": stage,
        "message": message,
        "recoverable": recoverable,
    })


async def sse_generator(events: AsyncGenerator[SSEMessage, None]) -> AsyncGenerator[str, None]:
    """Wrap an async generator of SSEMessages into SSE-formatted strings."""
    async for event in events:
        yield format_sse(event)
