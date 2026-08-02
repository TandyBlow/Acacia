import logging
import os
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel

from file_parser import extract_pdf_images
from parse_threads import enqueue_parse
from routers.auth_deps import get_current_user
from routers.extract_routes import _pipeline_manager

logger = logging.getLogger(__name__)

router = APIRouter()


def _cleanup_uploaded_file(owner_id: str, file_id: str):
    """Delete all cached files for an uploaded file (original, .txt, .formatted.txt, images)."""
    import glob as _glob
    import shutil as _shutil
    upload_dir = f"/tmp/acacia_uploads/{owner_id}"
    pattern = os.path.join(upload_dir, f"{file_id}.*")
    for f in _glob.glob(pattern):
        try:
            os.remove(f)
        except OSError:
            pass
    img_dir = os.path.join("/tmp/acacia_uploads/images", file_id)
    if os.path.isdir(img_dir):
        _shutil.rmtree(img_dir, ignore_errors=True)


def _cleanup_stale_uploads(max_age_seconds: int = 21600):
    """Remove uploaded files older than max_age_seconds (default 6 hours) from /tmp/acacia_uploads/."""
    import glob as _glob
    import shutil as _shutil
    uploads_root = "/tmp/acacia_uploads"
    if not os.path.isdir(uploads_root):
        return
    now = __import__("time").time()
    for owner_dir in os.listdir(uploads_root):
        owner_path = os.path.join(uploads_root, owner_dir)
        if owner_dir == "images":
            for img_dir in os.listdir(owner_path):
                img_path = os.path.join(owner_path, img_dir)
                try:
                    if now - os.path.getmtime(img_path) > max_age_seconds:
                        _shutil.rmtree(img_path, ignore_errors=True)
                except OSError:
                    pass
            continue
        if not os.path.isdir(owner_path):
            continue
        for fname in os.listdir(owner_path):
            fpath = os.path.join(owner_path, fname)
            try:
                if now - os.path.getmtime(fpath) > max_age_seconds:
                    os.remove(fpath)
            except OSError:
                pass
        # Remove empty owner dirs
        try:
            remaining = os.listdir(owner_path)
            if not remaining:
                os.rmdir(owner_path)
        except OSError:
            pass


@router.post("/upload-file")
async def upload_file_endpoint(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user)
):
    """
    Upload a file for knowledge point extraction.
    Supports: .txt, .md, .pdf, .docx, .ipynb, .py (max 10MB)

    File is saved to disk immediately, then parsed in a background thread.
    Returns immediately with status: "processing". Frontend polls
    GET /upload-status/{file_id} for parse completion.
    """
    owner_id = user["sub"]

    # Validate file size (10MB limit)
    MAX_FILE_SIZE = 10 * 1024 * 1024
    file_content = await file.read()
    if len(file_content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="文件大小超过10MB限制"
        )

    # Validate file extension
    file_ext = os.path.splitext(file.filename)[1].lower()
    if file_ext not in ['.txt', '.md', '.pdf', '.docx', '.ipynb', '.py']:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"不支持的文件类型：{file_ext}。支持的类型：.txt, .md, .pdf, .docx, .ipynb, .py"
        )

    # Create upload directory
    upload_dir = f"/tmp/acacia_uploads/{owner_id}"
    os.makedirs(upload_dir, exist_ok=True)

    # Generate unique file ID and save file
    file_id = str(uuid4())
    file_path = os.path.join(upload_dir, f"{file_id}{file_ext}")

    with open(file_path, 'wb') as f:
        f.write(file_content)

    # Extract embedded images from PDFs for use in formatted markdown
    images_extracted = 0
    if file_ext == '.pdf':
        try:
            img_dir = os.path.join("/tmp/acacia_uploads/images", file_id)
            img_list = extract_pdf_images(file_path, img_dir)
            images_extracted = len(img_list)
        except Exception as e:
            logger.warning("PDF image extraction failed for %s: %s", file_id, e)

    # Enqueue background parsing — returns immediately
    enqueue_parse(file_id, file_path, owner_id, file_ext, file.filename)

    # Start pipeline as a background asyncio task for real-time SSE streaming
    if _pipeline_manager is not None:
        await _pipeline_manager.start_pipeline(
            file_id=file_id,
            file_path=file_path,
            owner_id=owner_id,
            file_ext=file_ext,
            original_filename=file.filename,
        )

    return {
        "file_id": file_id,
        "filename": file.filename,
        "size": len(file_content),
        "extension": file_ext,
        "status": "processing",
    }


class CleanupFileRequest(BaseModel):
    file_id: str


@router.post("/cleanup-file")
def cleanup_file_endpoint(
    request: CleanupFileRequest,
    user: dict = Depends(get_current_user)
):
    """Delete uploaded file caches after the file has been consumed
    (content filled into node, chat ended, etc.). Idempotent."""
    _cleanup_uploaded_file(user["sub"], request.file_id)
    return {"status": "ok"}
