import glob
import json
import os

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse

from routers.auth_deps import get_current_user

router = APIRouter()

try:
    from pipeline_task_manager import _pipeline_manager
except Exception:
    import logging as _logging
    _logging.getLogger(__name__).exception("pipeline_task_manager import failed")
    _pipeline_manager = None


@router.get("/extract-stream/{file_id}")
async def extract_stream_endpoint(
    file_id: str,
    max_pages: int = 0,
    user: dict = Depends(get_current_user)
):
    """SSE streaming endpoint: stream pipeline events from the background task.

    The pipeline is started by POST /upload-file as a background asyncio.Task.
    This endpoint reads events from the task's buffered event stream.
    Falls back to cached result or inline pipeline if the task is not found.
    """
    import glob as glob_mod
    import json as _json

    owner_id = user["sub"]
    upload_dir = f"/tmp/acacia_uploads/{owner_id}"

    # Path A: pipeline running in this worker process
    if _pipeline_manager is not None and _pipeline_manager.has_task(file_id):
        async def event_generator():
            async for sse_str in _pipeline_manager.get_events(file_id):
                yield sse_str
            await _pipeline_manager.cleanup(file_id)

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    # Path B: cross-worker — check on-disk formatted cache
    fmt_cache_path = os.path.join(upload_dir, f"{file_id}.formatted.txt")
    if os.path.exists(fmt_cache_path):
        with open(fmt_cache_path, "r", encoding="utf-8") as f:
            formatted = f.read()

        pattern = os.path.join(upload_dir, f"{file_id}.*")
        matches = [m for m in glob_mod.glob(pattern)
                   if not m.endswith('.txt') and not m.endswith('.formatted.txt')]
        file_name = os.path.basename(matches[0]) if matches else file_id

        async def cached_event_generator():
            yield f"event: pipeline_start\ndata: {_json.dumps({'file_name': file_name, 'page_count': 0, 'total_chars': len(formatted)})}\n\n"
            yield f"event: stage_progress\ndata: {_json.dumps({'stage': 'merge', 'detail': 'Retrieved cached result', 'percent': 100, 'stageMs': 0, 'totalMs': 0})}\n\n"
            yield f"event: pipeline_complete\ndata: {_json.dumps({'total_markdown_length': len(formatted), 'issues_found': 0, 'issues_resolved': 0, 'unresolved': 0, 'final_markdown': formatted})}\n\n"

        return StreamingResponse(
            cached_event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    # Path C: no cached result — find file and start fallback pipeline
    pattern = os.path.join(upload_dir, f"{file_id}.*")
    matches = [m for m in glob_mod.glob(pattern)
               if not m.endswith('.txt') and not m.endswith('.formatted.txt')]
    if not matches:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found. Upload first via POST /upload-file."
        )
    file_path = matches[0]
    file_ext = os.path.splitext(file_path)[1].lower()

    if _pipeline_manager is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Pipeline service unavailable. Please try again later."
        )

    await _pipeline_manager.start_pipeline(
        file_id=file_id,
        file_path=file_path,
        owner_id=owner_id,
        file_ext=file_ext,
        max_pages=max_pages,
    )

    async def fallback_event_generator():
        async for sse_str in _pipeline_manager.get_events(file_id):
            yield sse_str
        await _pipeline_manager.cleanup(file_id)

    return StreamingResponse(
        fallback_event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
