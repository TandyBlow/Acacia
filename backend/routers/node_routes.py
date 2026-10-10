from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel

from database import get_db_ctx
from routers.auth_deps import get_current_user
from routers.versioning import set_etag

router = APIRouter()


# --- Node CRUD ---

class NodeCreateRequest(BaseModel):
    name: str
    parent_id: str | None = None


def _build_path(conn, node_id: str) -> list[dict]:
    path = []
    visited = set()
    # Start from parent to exclude the node itself from path
    node_row = conn.execute(
        "SELECT parent_id FROM nodes WHERE id = ?",
        (node_id,),
    ).fetchone()
    if not node_row or not node_row["parent_id"]:
        return []
    current_id = node_row["parent_id"]
    while current_id:
        if current_id in visited:
            break
        visited.add(current_id)
        row = conn.execute(
            "SELECT id, name, content, parent_id, sort_order FROM nodes WHERE id = ?",
            (current_id,),
        ).fetchone()
        if not row:
            break
        path.append(dict(row))
        current_id = row["parent_id"]
    path.reverse()
    return path


def _node_to_dict(row) -> dict:
    keys = row.keys()
    return {
        "id": row["id"],
        "name": row["name"],
        "content": row["content"] or "",
        "parentId": row["parent_id"],
        "sortOrder": row["sort_order"],
        # Present on rows selected from nodes after the revision backfill;
        # older narrow selects (path building) simply omit it.
        "revision": row["revision"] if "revision" in keys else None,
    }


@router.get("/nodes/context/{node_id}")
def get_node_context(
    node_id: str | None = None,
    response: Response = None,
    user: dict = Depends(get_current_user),
):
    owner_id = user["sub"]
    with get_db_ctx() as conn:
        if not node_id or node_id == "null":
            children = conn.execute(
                "SELECT * FROM nodes WHERE owner_id = ? AND parent_id IS NULL AND is_deleted = 0 ORDER BY sort_order",
                (owner_id,),
            ).fetchall()
            return {
                "nodeInfo": None,
                "pathNodes": [],
                "children": [_node_to_dict(c) for c in children],
            }

        node = conn.execute(
            "SELECT * FROM nodes WHERE id = ? AND owner_id = ? AND is_deleted = 0",
            (node_id, owner_id),
        ).fetchone()
        if not node:
            children = conn.execute(
                "SELECT * FROM nodes WHERE owner_id = ? AND parent_id IS NULL AND is_deleted = 0 ORDER BY sort_order",
                (owner_id,),
            ).fetchall()
            return {
                "nodeInfo": None,
                "pathNodes": [],
                "children": [_node_to_dict(c) for c in children],
            }

        path = _build_path(conn, node_id)
        children = conn.execute(
            "SELECT * FROM nodes WHERE owner_id = ? AND parent_id = ? AND is_deleted = 0 ORDER BY sort_order",
            (owner_id, node_id),
        ).fetchall()

        if response is not None and node["revision"] is not None:
            set_etag(response, node["revision"])

        return {
            "nodeInfo": _node_to_dict(node),
            "pathNodes": [_node_to_dict(p) for p in path],
            "children": [_node_to_dict(c) for c in children],
        }


@router.post("/nodes")
def create_node(payload: NodeCreateRequest, user: dict = Depends(get_current_user)):
    owner_id = user["sub"]
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Node name cannot be empty")

    with get_db_ctx() as conn:
        if payload.parent_id:
            existing = conn.execute(
                "SELECT id FROM nodes WHERE owner_id = ? AND parent_id = ? AND name = ? AND is_deleted = 0",
                (owner_id, payload.parent_id, name),
            ).fetchone()
            if existing:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Sibling with same name already exists")

        max_order = conn.execute(
            "SELECT COALESCE(MAX(sort_order), -1) FROM nodes WHERE owner_id = ? AND parent_id IS ? AND is_deleted = 0",
            (owner_id, payload.parent_id),
        ).fetchone()[0]

        node_id = str(uuid4())
        conn.execute(
            "INSERT INTO nodes (id, owner_id, name, content, parent_id, sort_order) VALUES (?, ?, ?, '', ?, ?)",
            (node_id, owner_id, name, payload.parent_id, max_order + 1),
        )

        if payload.parent_id:
            conn.execute(
                "INSERT OR IGNORE INTO edges (parent_id, child_id, sort_order) VALUES (?, ?, ?)",
                (payload.parent_id, node_id, max_order + 1),
            )

        result = _node_to_dict(conn.execute("SELECT * FROM nodes WHERE id = ?", (node_id,)).fetchone())

        # Warn if the node name looks like an undefined abbreviation
        from chat_service import detect_abbreviation_name
        warning = detect_abbreviation_name(name)
        if warning:
            result["warning"] = warning

        return result


@router.get("/tree")
def get_tree(user: dict = Depends(get_current_user)):
    owner_id = user["sub"]
    with get_db_ctx() as conn:
        rows = conn.execute(
            "SELECT id, name, parent_id FROM nodes WHERE owner_id = ? AND is_deleted = 0 ORDER BY sort_order",
            (owner_id,),
        ).fetchall()

    nodes = [{"id": r["id"], "name": r["name"], "parentId": r["parent_id"], "children": []} for r in rows]
    by_id = {n["id"]: n for n in nodes}
    roots = []
    for n in nodes:
        if n["parentId"] and n["parentId"] in by_id:
            by_id[n["parentId"]]["children"].append(n)
        else:
            roots.append(n)
    return roots
