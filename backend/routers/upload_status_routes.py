import glob
import os

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from file_parser import parse_file, get_file_info
from parse_format import should_preserve_verbatim
from parse_threads import get_parse_progress
from routers.auth_deps import get_current_user

router = APIRouter()


@router.get("/upload-status/{file_id}")
def get_upload_status_endpoint(
    file_id: str,
    user: dict = Depends(get_current_user)
):
    """Poll file parse progress. Returns status + result when ready.

    Used by the frontend to show parsing progress after upload.
    Poll interval: 500ms.
    """
    owner_id = user["sub"]

    progress = get_parse_progress(file_id)
    if progress is not None:
        return progress

    # No in-memory task — check if cache exists (parse may have completed
    # before the progress state was garbage-collected, or server restarted)
    cache_path = os.path.join(
        f"/tmp/acacia_uploads/{owner_id}", f"{file_id}.txt"
    )
    if os.path.exists(cache_path):
        # Reconstruct the file info from disk
        import glob as glob_mod
        pattern = os.path.join(f"/tmp/acacia_uploads/{owner_id}", f"{file_id}.*")
        matches = [m for m in glob_mod.glob(pattern) if not m.endswith('.txt')]
        if matches:
            file_path = matches[0]
            file_info = get_file_info(file_path)
            with open(cache_path, 'r', encoding='utf-8') as f:
                text = f.read()
            return {
                "status": "ready",
                "stage": "ready",
                "error": "",
                "result": {
                    "file_id": file_id,
                    "filename": os.path.basename(file_path),
                    "size": file_info["size"],
                    "extension": file_info["extension"],
                    "text_length": len(text),
                    "text_preview": text[:200] + "..." if len(text) > 200 else text,
                    "ocr_applied": False,
                    "ocr_reason": None,
                    "ocr_status": "not_needed",
                    "total_pages": 0,
                },
            }

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="No parse task found for this file"
    )


@router.get("/file-content/{file_id}")
def get_file_content_endpoint(
    file_id: str,
    user: dict = Depends(get_current_user)
):
    """Get the full text content of an uploaded file."""
    import glob as glob_mod
    owner_id = user["sub"]
    upload_dir = f"/tmp/acacia_uploads/{owner_id}"

    pattern = os.path.join(upload_dir, f"{file_id}.*")
    matches = [
        m for m in glob_mod.glob(pattern)
        if not m.endswith('.txt') and not m.endswith('.formatted.txt')
    ]
    raw_ext = os.path.splitext(matches[0])[1].lower() if matches else ""

    # Markdown is already a source format; always prefer the raw parsed cache
    # over any stale formatted cache so formulas and tables are preserved.
    cache_path = os.path.join(upload_dir, f"{file_id}.txt")
    if should_preserve_verbatim(raw_ext) and os.path.exists(cache_path):
        with open(cache_path, 'r', encoding='utf-8') as f:
            full_text = f.read()
        return {
            "file_id": file_id,
            "filename": os.path.basename(matches[0]) if matches else "",
            "full_text": full_text,
            "from_cache": True,
        }

    # Check for formatted text first (pipeline result), then raw text
    fmt_path = os.path.join(upload_dir, f"{file_id}.formatted.txt")
    if os.path.exists(fmt_path):
        with open(fmt_path, 'r', encoding='utf-8') as f:
            full_text = f.read()
        return {
            "file_id": file_id,
            "filename": "",
            "full_text": full_text,
            "from_cache": True,
        }

    if os.path.exists(cache_path):
        with open(cache_path, 'r', encoding='utf-8') as f:
            full_text = f.read()
        return {
            "file_id": file_id,
            "filename": "",
            "full_text": full_text,
            "from_cache": True,
        }

    if not matches:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="文件不存在或已过期"
        )
    try:
        text_content = parse_file(matches[0])
        file_info = get_file_info(matches[0])
        return {
            "file_id": file_id,
            "filename": file_info.get("filename", ""),
            "full_text": text_content,
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"文件读取失败：{str(e)}"
        )


@router.get("/file-images/{file_id}/{filename}")
def serve_file_image(file_id: str, filename: str):
    """Serve an extracted PDF image (public, file_id is unguessable UUID)."""
    img_path = os.path.join("/tmp/acacia_uploads/images", file_id, filename)
    if not os.path.exists(img_path):
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(img_path)


@router.get("/file-images/{file_id}")
def list_file_images(file_id: str):
    """List extracted images for a file (public)."""
    img_dir = os.path.join("/tmp/acacia_uploads/images", file_id)
    if not os.path.exists(img_dir):
        return {"images": []}
    files = sorted(os.listdir(img_dir))
    return {"images": [{"filename": f} for f in files]}
