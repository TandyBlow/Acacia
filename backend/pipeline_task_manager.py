"""
Background pipeline task manager for file extraction.

Decouples pipeline execution from the SSE request handler:
- Pipeline starts immediately after upload (POST /upload-file)
- SSE endpoint (GET /extract-stream) reads from a buffered event stream
- Supports multiple concurrent SSE readers and late-joining clients
"""

import asyncio
import json
import logging
import os
import time
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


class _PipelineState:
    """Per-file pipeline state shared between the background task and SSE readers."""

    def __init__(self, file_id: str):
        self.file_id = file_id
        self.status = "running"
        self.buffered_events: List[str] = []
        self.new_event = asyncio.Event()
        self.done = asyncio.Event()
        self.final_markdown = ""
        self.error_message = ""
        self.task: Optional[asyncio.Task] = None


class PipelineTaskManager:
    """Manages lifecycle of background pipeline tasks.

    Module-level singleton: _pipeline_manager.
    Uses asyncio.Event for signaling — supports multiple concurrent SSE readers
    and late-joining clients that receive a full event replay from the buffer.
    """

    def __init__(self):
        self._states: Dict[str, _PipelineState] = {}

    async def start_pipeline(
        self,
        file_id: str,
        file_path: str,
        owner_id: str,
        file_ext: str,
        original_filename: str = "",
        max_pages: int = 0,
    ):
        """Launch the pipeline as a background asyncio.Task. Returns immediately."""
        if file_id in self._states:
            logger.warning("Pipeline already registered for %s, skipping", file_id)
            return

        state = _PipelineState(file_id)
        self._states[file_id] = state

        is_pdf = file_path.lower().endswith(".pdf")
        if is_pdf:
            state.task = asyncio.create_task(
                self._run_pdf_pipeline(state, file_path, owner_id, max_pages)
            )
        else:
            state.task = asyncio.create_task(
                self._run_nonpdf_pipeline(state, file_path, owner_id, file_ext)
            )

    async def get_events(self, file_id: str):
        """Async generator yielding SSE-formatted strings.

        Replays buffered events first (for late-joining clients), then streams
        new events as they arrive. Terminates when the pipeline signals done.
        """
        state = self._states.get(file_id)
        if state is None:
            return

        position = 0
        while True:
            while position < len(state.buffered_events):
                yield state.buffered_events[position]
                position += 1

            if state.done.is_set():
                return

            state.new_event.clear()
            if position < len(state.buffered_events):
                continue
            await state.new_event.wait()

    async def cancel(self, file_id: str):
        """Cancel a running pipeline task."""
        state = self._states.get(file_id)
        if state is None:
            return
        if state.task and not state.task.done():
            state.task.cancel()
        state.status = "failed"
        state.error_message = "Cancelled by user"
        state.done.set()
        state.new_event.set()

    async def cleanup(self, file_id: str):
        """Remove pipeline state after streaming is complete."""
        self._states.pop(file_id, None)

    def has_task(self, file_id: str) -> bool:
        """Check if a pipeline task is registered in this process."""
        return file_id in self._states

    def get_state(self, file_id: str) -> Optional[Dict]:
        """Return a snapshot of pipeline state for diagnostics."""
        state = self._states.get(file_id)
        if state is None:
            return None
        return {
            "file_id": state.file_id,
            "status": state.status,
            "final_markdown_length": len(state.final_markdown),
            "error": state.error_message,
            "events_buffered": len(state.buffered_events),
        }

    # ── internal runners ────────────────────────────────────────────────

    async def _run_pdf_pipeline(
        self, state: _PipelineState, file_path: str, owner_id: str, max_pages: int
    ):
        """Background coroutine: run FullPipeline and buffer SSE events."""
        from pdf_markdown.pipeline import FullPipeline
        from pdf_markdown.streaming import format_sse

        pipe = FullPipeline(file_path, max_pages=max_pages)
        try:
            async for event in pipe.run_streaming():
                sse_str = format_sse(event)
                state.buffered_events.append(sse_str)
                state.new_event.set()
                if event.event == "pipeline_complete":
                    state.final_markdown = event.data.get("final_markdown", "")
                    state.status = "completed"

            if state.final_markdown:
                self._write_cache(owner_id, state.file_id, state.final_markdown)

        except asyncio.CancelledError:
            state.status = "failed"
            state.error_message = "Cancelled by user"
        except Exception as exc:
            logger.error("PDF pipeline failed for %s: %s", state.file_id, exc)
            state.status = "failed"
            state.error_message = str(exc)
            error_sse = _make_error_sse("pipeline", str(exc), False)
            state.buffered_events.append(error_sse)
            state.new_event.set()
        finally:
            state.done.set()
            state.new_event.set()

    async def _run_nonpdf_pipeline(
        self, state: _PipelineState, file_path: str, owner_id: str, file_ext: str
    ):
        """Background coroutine: format non-PDF files and buffer SSE events."""
        from parse_task_manager import format_document_text, should_preserve_verbatim

        try:
            t_start = time.time()
            file_name = os.path.basename(file_path)
            cache_dir = f"/tmp/acacia_uploads/{owner_id}"

            cache_path = os.path.join(cache_dir, f"{state.file_id}.txt")
            if os.path.exists(cache_path):
                with open(cache_path, "r", encoding="utf-8") as f:
                    text_content = f.read()
            else:
                from file_parser import parse_file
                text_content = parse_file(file_path)

            total_chars = len(text_content)

            _emit(state, "pipeline_start", {
                "file_name": file_name,
                "page_count": 0,
                "total_chars": total_chars,
            })

            if not text_content.strip():
                _emit(state, "pipeline_error", {
                    "stage": "extract",
                    "message": "Empty file content",
                    "recoverable": False,
                })
                state.status = "failed"
                state.error_message = "Empty file content"
                return

            if should_preserve_verbatim(file_ext):
                _emit(state, "stage_progress", {
                    "stage": "merge",
                    "detail": "Preserving Markdown source...",
                    "percent": 90,
                    "stageMs": 0,
                    "totalMs": _elapsed_ms(t_start),
                })
                formatted = text_content
            else:
                _emit(state, "stage_progress", {
                    "stage": "annotate",
                    "detail": "Formatting with LLM...",
                    "percent": 30,
                    "stageMs": 0,
                    "totalMs": _elapsed_ms(t_start),
                })
                formatted = await asyncio.to_thread(
                    format_document_text, text_content
                )

            total_ms = _elapsed_ms(t_start)
            _emit(state, "stage_progress", {
                "stage": "merge",
                "detail": "Formatting complete",
                "percent": 90,
                "stageMs": total_ms,
                "totalMs": total_ms,
            })

            _emit(state, "pipeline_complete", {
                "total_markdown_length": len(formatted),
                "issues_found": 0,
                "issues_resolved": 0,
                "unresolved": 0,
                "final_markdown": formatted,
            })

            state.final_markdown = formatted
            state.status = "completed"

            self._write_cache(owner_id, state.file_id, formatted)

        except asyncio.CancelledError:
            state.status = "failed"
            state.error_message = "Cancelled by user"
        except Exception as exc:
            logger.error("Non-PDF pipeline failed for %s: %s", state.file_id, exc)
            state.status = "failed"
            state.error_message = str(exc)
            _emit(state, "pipeline_error", {
                "stage": "annotate",
                "message": str(exc),
                "recoverable": False,
            })
        finally:
            state.done.set()
            state.new_event.set()

    @staticmethod
    def _write_cache(owner_id: str, file_id: str, markdown: str):
        cache_dir = f"/tmp/acacia_uploads/{owner_id}"
        os.makedirs(cache_dir, exist_ok=True)
        fmt_cache_path = os.path.join(cache_dir, f"{file_id}.formatted.txt")
        try:
            with open(fmt_cache_path, "w", encoding="utf-8") as f:
                f.write(markdown)
        except Exception as e:
            logger.warning("Failed to write formatted cache for %s: %s", file_id, e)


# ── module-level singleton ──────────────────────────────────────────────

_pipeline_manager = PipelineTaskManager()


# ── helpers ─────────────────────────────────────────────────────────────

def _emit(state: _PipelineState, event: str, data: dict):
    """Format an SSE event string and append to buffer + signal readers."""
    sse_str = f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
    state.buffered_events.append(sse_str)
    state.new_event.set()


def _elapsed_ms(t_start: float) -> int:
    return int((time.time() - t_start) * 1000)


def _make_error_sse(stage: str, message: str, recoverable: bool = False) -> str:
    data = json.dumps({
        "stage": stage,
        "message": message,
        "recoverable": recoverable,
    }, ensure_ascii=False)
    return f"event: pipeline_error\ndata: {data}\n\n"
