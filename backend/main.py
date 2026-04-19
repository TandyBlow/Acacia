from uuid import uuid4

from fastapi import FastAPI, HTTPException, status, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, ConfigDict

from database import get_db_ctx, init_db
from auth import hash_password, verify_password, create_token, verify_token
from tree_generator import generate_tree_visualization
from tree_repository import fetch_user_tree
from tree_repository_sqlite import fetch_user_tree_sqlite
from lsystem import generate_lsystem_skeleton
from tag_service import tag_all_nodes
from tag_service_sqlite import tag_all_nodes_sqlite
from style_service import compute_style
from style_service_sqlite import compute_style_sqlite

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

security = HTTPBearer(auto_error=False)


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    payload = verify_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    return payload


@app.on_event("startup")
def startup():
    init_db()


@app.get("/")
def root():
    return {"status": "ok", "message": "SeeWhat API is running"}


@app.get("/health")
def health():
    return {"status": "healthy"}


# --- Auth ---

class RegisterRequest(BaseModel):
    username: str
    password: str


class LoginRequest(BaseModel):
    username: str
    password: str


@app.post("/auth/register")
def register(payload: RegisterRequest):
    if not payload.username.strip() or not payload.password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username and password required")

    with get_db_ctx() as conn:
        existing = conn.execute("SELECT id FROM users WHERE username = ?", (payload.username.strip(),)).fetchone()
        if existing:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists")

        user_id = str(uuid4())
        pw_hash = hash_password(payload.password)
        conn.execute(
            "INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)",
            (user_id, payload.username.strip(), pw_hash),
        )

    token = create_token(user_id, payload.username.strip())
    return {"token": token, "user": {"id": user_id, "username": payload.username.strip()}}


@app.post("/auth/login")
def login(payload: LoginRequest):
    with get_db_ctx() as conn:
        row = conn.execute("SELECT id, username, password_hash FROM users WHERE username = ?", (payload.username,)).fetchone()
        if not row or not verify_password(payload.password, row["password_hash"]):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")

    token = create_token(row["id"], row["username"])
    return {"token": token, "user": {"id": row["id"], "username": row["username"]}}


@app.get("/auth/me")
def me(user: dict = Depends(get_current_user)):
    return {"id": user["sub"], "username": user["username"]}


# --- Node CRUD ---

class NodeCreateRequest(BaseModel):
    name: str
    parent_id: str | None = None


class ContentUpdateRequest(BaseModel):
    content: str


class MoveRequest(BaseModel):
    new_parent_id: str | None = None


def _build_path(conn, node_id: str) -> list[dict]:
    """Walk up the parent chain to build an ancestor path."""
    path = []
    visited = set()
    current_id = node_id
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
    return {
        "id": row["id"],
        "name": row["name"],
        "content": row["content"] or "",
        "parentId": row["parent_id"],
        "sortOrder": row["sort_order"],
    }


@app.get("/nodes/context/{node_id}")
def get_node_context(node_id: str | None = None, user: dict = Depends(get_current_user)):
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
            # Return root context if node not found
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

        return {
            "nodeInfo": _node_to_dict(node),
            "pathNodes": [_node_to_dict(p) for p in path],
            "children": [_node_to_dict(c) for c in children],
        }


@app.post("/nodes")
def create_node(payload: NodeCreateRequest, user: dict = Depends(get_current_user)):
    owner_id = user["sub"]
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Node name cannot be empty")

    with get_db_ctx() as conn:
        # Check sibling name uniqueness
        if payload.parent_id:
            existing = conn.execute(
                "SELECT id FROM nodes WHERE owner_id = ? AND parent_id = ? AND name = ? AND is_deleted = 0",
                (owner_id, payload.parent_id, name),
            ).fetchone()
            if existing:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Sibling with same name already exists")

        # Get next sort order
        max_order = conn.execute(
            "SELECT COALESCE(MAX(sort_order), -1) FROM nodes WHERE owner_id = ? AND parent_id IS ? AND is_deleted = 0",
            (owner_id, payload.parent_id),
        ).fetchone()[0]

        node_id = str(uuid4())
        conn.execute(
            "INSERT INTO nodes (id, owner_id, name, content, parent_id, sort_order) VALUES (?, ?, ?, '', ?, ?)",
            (node_id, owner_id, name, payload.parent_id, max_order + 1),
        )

        # Create edge if parent exists
        if payload.parent_id:
            conn.execute(
                "INSERT OR IGNORE INTO edges (parent_id, child_id, sort_order) VALUES (?, ?, ?)",
                (payload.parent_id, node_id, max_order + 1),
            )

        return _node_to_dict(conn.execute("SELECT * FROM nodes WHERE id = ?", (node_id,)).fetchone())


@app.patch("/nodes/{node_id}/content")
def update_content(node_id: str, payload: ContentUpdateRequest, user: dict = Depends(get_current_user)):
    owner_id = user["sub"]
    with get_db_ctx() as conn:
        row = conn.execute(
            "SELECT id FROM nodes WHERE id = ? AND owner_id = ? AND is_deleted = 0",
            (node_id, owner_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")

        conn.execute(
            "UPDATE nodes SET content = ?, updated_at = datetime('now') WHERE id = ?",
            (payload.content, node_id),
        )

    return {"ok": True}


@app.delete("/nodes/{node_id}")
def delete_node(node_id: str, delete_children: bool = False, user: dict = Depends(get_current_user)):
    owner_id = user["sub"]
    with get_db_ctx() as conn:
        node = conn.execute(
            "SELECT * FROM nodes WHERE id = ? AND owner_id = ? AND is_deleted = 0",
            (node_id, owner_id),
        ).fetchone()
        if not node:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")

        if delete_children:
            # Soft-delete entire subtree
            conn.execute("UPDATE nodes SET is_deleted = 1 WHERE id = ?", (node_id,))
            _soft_delete_subtree(conn, node_id, owner_id)
            conn.execute("DELETE FROM edges WHERE parent_id = ? OR child_id = ?", (node_id, node_id))
        else:
            # Reparent children to node's parent
            children = conn.execute(
                "SELECT id, sort_order FROM nodes WHERE owner_id = ? AND parent_id = ? AND is_deleted = 0 ORDER BY sort_order",
                (owner_id, node_id),
            ).fetchall()

            parent_id = node["parent_id"]
            next_order = conn.execute(
                "SELECT COALESCE(MAX(sort_order), -1) FROM nodes WHERE owner_id = ? AND parent_id IS ? AND is_deleted = 0 AND id != ?",
                (owner_id, parent_id, node_id),
            ).fetchone()[0]

            for child in children:
                next_order += 1
                conn.execute(
                    "UPDATE nodes SET parent_id = ?, sort_order = ? WHERE id = ?",
                    (parent_id, next_order, child["id"]),
                )
                conn.execute("DELETE FROM edges WHERE child_id = ? AND parent_id = ?", (child["id"], node_id))
                if parent_id:
                    conn.execute(
                        "INSERT OR IGNORE INTO edges (parent_id, child_id, sort_order) VALUES (?, ?, ?)",
                        (parent_id, child["id"], next_order),
                    )

            conn.execute("UPDATE nodes SET is_deleted = 1 WHERE id = ?", (node_id,))
            conn.execute("DELETE FROM edges WHERE parent_id = ? OR child_id = ?", (node_id, node_id))

    return {"ok": True}


def _soft_delete_subtree(conn, parent_id: str, owner_id: str):
    children = conn.execute(
        "SELECT id FROM nodes WHERE owner_id = ? AND parent_id = ? AND is_deleted = 0",
        (owner_id, parent_id),
    ).fetchall()
    for child in children:
        conn.execute("UPDATE nodes SET is_deleted = 1 WHERE id = ?", (child["id"],))
        conn.execute("DELETE FROM edges WHERE parent_id = ? OR child_id = ?", (child["id"], child["id"]))
        _soft_delete_subtree(conn, child["id"], owner_id)


@app.patch("/nodes/{node_id}/move")
def move_node(node_id: str, payload: MoveRequest, user: dict = Depends(get_current_user)):
    owner_id = user["sub"]
    new_parent_id = payload.new_parent_id

    with get_db_ctx() as conn:
        node = conn.execute(
            "SELECT * FROM nodes WHERE id = ? AND owner_id = ? AND is_deleted = 0",
            (node_id, owner_id),
        ).fetchone()
        if not node:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")

        if node["parent_id"] == new_parent_id:
            return {"ok": True}

        # Validate new parent exists and is not a descendant
        if new_parent_id:
            parent = conn.execute(
                "SELECT id FROM nodes WHERE id = ? AND owner_id = ? AND is_deleted = 0",
                (new_parent_id, owner_id),
            ).fetchone()
            if not parent:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="New parent not found")

            if _is_descendant(conn, node_id, new_parent_id, owner_id):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot move node to its own descendant")

            # Check sibling name uniqueness
            existing = conn.execute(
                "SELECT id FROM nodes WHERE owner_id = ? AND parent_id = ? AND name = ? AND is_deleted = 0 AND id != ?",
                (owner_id, new_parent_id, node["name"], node_id),
            ).fetchone()
            if existing:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Sibling with same name already exists at destination")

        # Remove old edge
        old_parent_id = node["parent_id"]
        if old_parent_id:
            conn.execute("DELETE FROM edges WHERE parent_id = ? AND child_id = ?", (old_parent_id, node_id))

        # Get next sort order at destination
        next_order = conn.execute(
            "SELECT COALESCE(MAX(sort_order), -1) FROM nodes WHERE owner_id = ? AND parent_id IS ? AND is_deleted = 0",
            (owner_id, new_parent_id),
        ).fetchone()[0] + 1

        conn.execute(
            "UPDATE nodes SET parent_id = ?, sort_order = ?, updated_at = datetime('now') WHERE id = ?",
            (new_parent_id, next_order, node_id),
        )

        # Create new edge
        if new_parent_id:
            conn.execute(
                "INSERT OR IGNORE INTO edges (parent_id, child_id, sort_order) VALUES (?, ?, ?)",
                (new_parent_id, node_id, next_order),
            )

    return {"ok": True}


def _is_descendant(conn, ancestor_id: str, candidate_id: str, owner_id: str) -> bool:
    """Check if candidate_id is a descendant of ancestor_id."""
    children = conn.execute(
        "SELECT id FROM nodes WHERE owner_id = ? AND parent_id = ? AND is_deleted = 0",
        (owner_id, ancestor_id),
    ).fetchall()
    for child in children:
        if child["id"] == candidate_id:
            return True
        if _is_descendant(conn, child["id"], candidate_id, owner_id):
            return True
    return False


@app.get("/tree")
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


# --- Tree visualization (Supabase-backed, existing) ---

@app.post("/generate-tree/{user_id}")
def generate_tree(user_id: str):
    try:
        png_url = generate_tree_visualization(user_id)
        return {"png_url": png_url}
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@app.post("/generate-tree-skeleton/{user_id}")
def generate_tree_skeleton(user_id: str):
    try:
        tree_data = fetch_user_tree(user_id)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

    if not tree_data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"No tree data found for user {user_id}")

    return generate_lsystem_skeleton(tree_data)


@app.post("/tag-nodes/{user_id}")
def tag_nodes(user_id: str):
    try:
        return tag_all_nodes(user_id)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@app.get("/style/{user_id}")
def get_style(user_id: str):
    try:
        return compute_style(user_id)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


# --- Tree visualization (SQLite-backed, for local mode) ---

@app.post("/local/generate-tree-skeleton")
def generate_tree_skeleton_local(user: dict = Depends(get_current_user)):
    owner_id = user["sub"]
    try:
        tree_data = fetch_user_tree_sqlite(owner_id)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

    if not tree_data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No tree data found")

    return generate_lsystem_skeleton(tree_data)


@app.post("/local/tag-nodes")
def tag_nodes_local(user: dict = Depends(get_current_user)):
    owner_id = user["sub"]
    try:
        return tag_all_nodes_sqlite(owner_id)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@app.get("/local/style")
def get_style_local(user: dict = Depends(get_current_user)):
    owner_id = user["sub"]
    try:
        return compute_style_sqlite(owner_id)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
