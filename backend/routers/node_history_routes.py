"""Per-node content history: list, read, and restore previous versions.

Complements the ETag/If-Match protocol on content updates: restores are
version-checked the same way, and the pre-restore content is pinned so the
daily 50-version pruning can never remove the user's way back.
"""
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status

from database import get_db_ctx
from routers.auth_deps import get_current_user
from routers.versioning import ensure_matches, require_if_match, set_etag

router = APIRouter()

PREVIEW_LENGTH = 100


def _load_owned_node(conn, node_id: str, owner_id: str):
    node = conn.execute(
        "SELECT id, revision, content FROM nodes WHERE id = ? AND owner_id = ? AND is_deleted = 0",
        (node_id, owner_id),
    ).fetchone()
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")
    return node


@router.get("/nodes/{node_id}/content-history")
def list_history(node_id: str, user: dict = Depends(get_current_user)):
    owner_id = user["sub"]
    with get_db_ctx() as conn:
        _load_owned_node(conn, node_id, owner_id)
        rows = conn.execute(
            "SELECT id, source, pinned, length(content) AS length, content, created_at "
            "FROM node_content_history WHERE node_id = ? AND owner_id = ? "
            "ORDER BY created_at DESC, rowid DESC",
            (node_id, owner_id),
        ).fetchall()

    return [
        {
            "id": r["id"],
            "source": r["source"],
            "pinned": bool(r["pinned"]),
            "length": r["length"],
            "preview": (r["content"] or "")[:PREVIEW_LENGTH],
            "createdAt": r["created_at"],
        }
        for r in rows
    ]


@router.get("/nodes/{node_id}/content-history/{history_id}")
def get_history_entry(node_id: str, history_id: str, user: dict = Depends(get_current_user)):
    owner_id = user["sub"]
    with get_db_ctx() as conn:
        _load_owned_node(conn, node_id, owner_id)
        row = conn.execute(
            "SELECT id, content, source, pinned, created_at FROM node_content_history "
            "WHERE id = ? AND node_id = ? AND owner_id = ?",
            (history_id, node_id, owner_id),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="History entry not found")

    return {
        "id": row["id"],
        "content": row["content"],
        "source": row["source"],
        "pinned": bool(row["pinned"]),
        "createdAt": row["created_at"],
    }


@router.post("/nodes/{node_id}/content-history/{history_id}/restore")
def restore_history(
    node_id: str,
    history_id: str,
    response: Response,
    user: dict = Depends(get_current_user),
    if_match: str | None = Header(default=None, alias="If-Match"),
):
    owner_id = user["sub"]
    expected = require_if_match(if_match)

    with get_db_ctx() as conn:
        conn.execute("BEGIN IMMEDIATE")
        node = _load_owned_node(conn, node_id, owner_id)
        current = node["revision"]
        ensure_matches(expected, current)

        entry = conn.execute(
            "SELECT id, content FROM node_content_history WHERE id = ? AND node_id = ? AND owner_id = ?",
            (history_id, node_id, owner_id),
        ).fetchone()
        if not entry:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="History entry not found")

        if entry["content"] == (node["content"] or ""):
            set_etag(response, current)
            return {"ok": True, "revision": current, "unchanged": True}

        # Pin the pre-restore content so pruning can never remove the way back.
        conn.execute(
            "INSERT INTO node_content_history (id, node_id, owner_id, content, source, pinned) "
            "VALUES (?, ?, ?, ?, 'restore-backup', 1)",
            (str(uuid4()), node_id, owner_id, node["content"] or ""),
        )
        new_revision = current + 1
        conn.execute(
            "UPDATE nodes SET content = ?, revision = ?, updated_at = datetime('now') WHERE id = ?",
            (entry["content"], new_revision, node_id),
        )

    set_etag(response, new_revision)
    return {"ok": True, "revision": new_revision}
