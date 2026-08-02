import logging
import os

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from file_parser import parse_file
from routers.auth_deps import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/ocr-progress/{file_id}")
def get_ocr_progress_endpoint(
    file_id: str,
    user: dict = Depends(get_current_user)
):
    """Poll OCR progress for a file. Returns status + page counts.

    Used by the frontend to show a progress bar while background OCR runs.
    Poll interval: 2 seconds.
    """
    from ocr_task_manager import get_ocr_progress
    owner_id = user["sub"]

    progress = get_ocr_progress(file_id)
    if progress is not None:
        return progress

    # No in-memory task — check if cache exists (OCR may have completed
    # before the progress state was garbage-collected, or server restarted)
    cache_path = os.path.join(
        f"/tmp/acacia_uploads/{owner_id}", f"{file_id}.txt"
    )
    if os.path.exists(cache_path):
        with open(cache_path, 'r', encoding='utf-8') as f:
            text = f.read()
        return {
            "status": "done",
            "total_pages": -1,
            "completed_pages": -1,
            "has_text": bool(text.strip()),
        }

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="No OCR task found for this file"
    )


class FormatContentRequest(BaseModel):
    file_id: str


@router.post("/format-content")
def format_content_endpoint(
    request: FormatContentRequest,
    user: dict = Depends(get_current_user)
):
    """Format extracted PDF text as clean Markdown with LaTeX math via AI.

    Long texts are split into chunks and formatted separately to avoid
    hitting token limits. Extracted PDF images are referenced in the output.
    """
    import glob as glob_mod
    import httpx

    owner_id = user["sub"]
    upload_dir = f"/tmp/acacia_uploads/{owner_id}"

    # Read cached text (already cleaned by parse_pdf → _clean_pdf_text)
    cache_path = os.path.join(upload_dir, f"{request.file_id}.txt")
    if os.path.exists(cache_path):
        with open(cache_path, 'r', encoding='utf-8') as f:
            text_content = f.read()
    else:
        pattern = os.path.join(upload_dir, f"{request.file_id}.*")
        matches = glob_mod.glob(pattern)
        if not matches:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文件不存在")
        text_content = parse_file(matches[0])

    if not text_content.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="文件内容为空")

    # Check for extracted images
    img_dir = os.path.join("/tmp/acacia_uploads/images", request.file_id)
    image_urls: list[str] = []
    if os.path.exists(img_dir):
        image_urls = sorted(
            f"/file-images/{request.file_id}/{f}"
            for f in os.listdir(img_dir)
        )

    from parse_format import format_document_text

    try:
        formatted = format_document_text(text_content, image_urls)

        # Cache formatted text so line-by-line chat can use it too
        fmt_cache_path = os.path.join(upload_dir, f"{request.file_id}.formatted.txt")
        try:
            with open(fmt_cache_path, 'w', encoding='utf-8') as f:
                f.write(formatted)
        except Exception as e:
            logger.warning("Failed to write formatted cache for %s: %s", request.file_id, e)

        return {"formatted_text": formatted}
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"AI API error: {e.response.status_code}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"格式化失败：{str(e)}")
