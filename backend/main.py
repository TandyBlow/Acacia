from uuid import uuid4

from fastapi import FastAPI, HTTPException, status, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel

import os
from dotenv import load_dotenv

load_dotenv()

from database import get_db_ctx, init_db
from auth import hash_password, verify_password, create_token, verify_token
from tree_repository_sqlite import fetch_user_tree_sqlite
from lsystem import generate_lsystem_skeleton
from tree_skeleton import generate_tree_skeleton as generate_sc_skeleton
from tag_service_sqlite import tag_all_nodes_sqlite
from style_service_sqlite import compute_style_sqlite
from ai_generate_service_sqlite import ai_generate_nodes_sqlite, analyze_node_content_sqlite
from quiz_service_sqlite import (
    generate_quiz_question_sqlite,
    generate_batch_questions_sqlite,
    get_questions_by_node_sqlite,
    get_wrong_questions_sqlite,
    get_single_question_sqlite,
    submit_quiz_answer_sqlite,
    get_quiz_stats_sqlite,
)
from review_service_sqlite import (
    get_due_reviews_sqlite,
    submit_review_sqlite,
    get_review_stats_sqlite,
)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

security = HTTPBearer(auto_error=False)

TREE_GEN_VERSION = int(os.environ.get("TREE_GEN_VERSION", "2"))


def _generate_skeleton(tree_data, canvas_w=512, canvas_h=512):
    if TREE_GEN_VERSION == 2:
        return generate_sc_skeleton(tree_data, canvas_w, canvas_h)
    return generate_lsystem_skeleton(tree_data, canvas_w, canvas_h)


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
    return {"status": "ok", "message": "Acacia API is running"}


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
            conn.execute("UPDATE nodes SET is_deleted = 1 WHERE id = ?", (node_id,))
            _soft_delete_subtree(conn, node_id, owner_id)
            conn.execute("DELETE FROM edges WHERE parent_id = ? OR child_id = ?", (node_id, node_id))
        else:
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

        if new_parent_id:
            parent = conn.execute(
                "SELECT id FROM nodes WHERE id = ? AND owner_id = ? AND is_deleted = 0",
                (new_parent_id, owner_id),
            ).fetchone()
            if not parent:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="New parent not found")

            if _is_descendant(conn, node_id, new_parent_id, owner_id):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot move node to its own descendant")

            existing = conn.execute(
                "SELECT id FROM nodes WHERE owner_id = ? AND parent_id = ? AND name = ? AND is_deleted = 0 AND id != ?",
                (owner_id, new_parent_id, node["name"], node_id),
            ).fetchone()
            if existing:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Sibling with same name already exists at destination")

        old_parent_id = node["parent_id"]
        if old_parent_id:
            conn.execute("DELETE FROM edges WHERE parent_id = ? AND child_id = ?", (old_parent_id, node_id))

        next_order = conn.execute(
            "SELECT COALESCE(MAX(sort_order), -1) FROM nodes WHERE owner_id = ? AND parent_id IS ? AND is_deleted = 0",
            (owner_id, new_parent_id),
        ).fetchone()[0] + 1

        conn.execute(
            "UPDATE nodes SET parent_id = ?, sort_order = ?, updated_at = datetime('now') WHERE id = ?",
            (new_parent_id, next_order, node_id),
        )

        if new_parent_id:
            conn.execute(
                "INSERT OR IGNORE INTO edges (parent_id, child_id, sort_order) VALUES (?, ?, ?)",
                (new_parent_id, node_id, next_order),
            )

    return {"ok": True}


def _is_descendant(conn, ancestor_id: str, candidate_id: str, owner_id: str) -> bool:
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


# --- Tree visualization ---

class CanvasSize(BaseModel):
    canvas_w: int = 512
    canvas_h: int = 512


@app.post("/generate-tree-skeleton")
def generate_tree_skeleton_endpoint(user: dict = Depends(get_current_user), body: CanvasSize = CanvasSize()):
    owner_id = user["sub"]
    try:
        tree_data = fetch_user_tree_sqlite(owner_id)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

    if not tree_data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No tree data found")

    return _generate_skeleton(tree_data, body.canvas_w, body.canvas_h)


@app.post("/tag-nodes")
def tag_nodes_endpoint(user: dict = Depends(get_current_user)):
    owner_id = user["sub"]
    try:
        return tag_all_nodes_sqlite(owner_id)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@app.get("/style")
def get_style_endpoint(user: dict = Depends(get_current_user)):
    owner_id = user["sub"]
    try:
        return compute_style_sqlite(owner_id)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


# --- AI node generation ---

class AiGenerateRequest(BaseModel):
    input: str


@app.post("/ai-generate-nodes")
def ai_generate_endpoint(payload: AiGenerateRequest, user: dict = Depends(get_current_user)):
    owner_id = user["sub"]
    if not payload.input.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Input text is required")
    with get_db_ctx() as conn:
        try:
            return ai_generate_nodes_sqlite(payload.input.strip(), owner_id, conn)
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@app.post("/analyze-node/{node_id}")
def analyze_node_endpoint(node_id: str, user: dict = Depends(get_current_user)):
    owner_id = user["sub"]
    with get_db_ctx() as conn:
        try:
            return analyze_node_content_sqlite(node_id, owner_id, conn)
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


# --- Quiz ---

class QuizAnswerRequest(BaseModel):
    is_correct: bool
    question_id: str | None = None


class BatchGenerateRequest(BaseModel):
    count: int = 5
    include_children: bool = False
    question_types: list[str] = ["single_choice"]


class ReviewRequest(BaseModel):
    rating: int  # 1=Again, 2=Hard, 3=Good, 4=Easy


@app.post("/generate-question/{node_id}")
def generate_question_endpoint(
    node_id: str,
    user: dict = Depends(get_current_user),
    question_type: str = "single_choice",
    difficulty: str = "medium",
):
    owner_id = user["sub"]
    with get_db_ctx() as conn:
        try:
            return generate_quiz_question_sqlite(node_id, owner_id, conn, question_type, difficulty)
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@app.post("/generate-batch/{node_id}")
def generate_batch_endpoint(node_id: str, payload: BatchGenerateRequest, user: dict = Depends(get_current_user)):
    owner_id = user["sub"]
    with get_db_ctx() as conn:
        try:
            return generate_batch_questions_sqlite(
                node_id, owner_id, conn,
                count=payload.count,
                include_children=payload.include_children,
                question_types=payload.question_types,
            )
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@app.get("/quiz-questions/{node_id}")
def get_questions_endpoint(node_id: str, user: dict = Depends(get_current_user)):
    owner_id = user["sub"]
    with get_db_ctx() as conn:
        try:
            return get_questions_by_node_sqlite(node_id, owner_id, conn)
        except Exception as e:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@app.get("/quiz-questions/{node_id}/{question_id}")
def get_single_question_endpoint(node_id: str, question_id: str, user: dict = Depends(get_current_user)):
    owner_id = user["sub"]
    with get_db_ctx() as conn:
        try:
            return get_single_question_sqlite(question_id, owner_id, conn)
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@app.get("/wrong-questions")
def wrong_questions_endpoint(limit: int = 20, user: dict = Depends(get_current_user)):
    owner_id = user["sub"]
    with get_db_ctx() as conn:
        try:
            return get_wrong_questions_sqlite(owner_id, conn, limit)
        except Exception as e:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@app.post("/submit-answer/{node_id}")
def submit_answer_endpoint(node_id: str, payload: QuizAnswerRequest, user: dict = Depends(get_current_user)):
    owner_id = user["sub"]
    with get_db_ctx() as conn:
        try:
            return submit_quiz_answer_sqlite(node_id, owner_id, payload.is_correct, conn, payload.question_id)
        except Exception as e:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@app.get("/quiz-stats")
def quiz_stats_endpoint(user: dict = Depends(get_current_user)):
    owner_id = user["sub"]
    with get_db_ctx() as conn:
        try:
            return get_quiz_stats_sqlite(owner_id, conn)
        except Exception as e:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@app.get("/due-reviews")
def due_reviews_endpoint(limit: int = 20, user: dict = Depends(get_current_user)):
    owner_id = user["sub"]
    with get_db_ctx() as conn:
        try:
            return get_due_reviews_sqlite(owner_id, conn, limit)
        except Exception as e:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@app.post("/review/{node_id}")
def review_endpoint(node_id: str, payload: ReviewRequest, user: dict = Depends(get_current_user)):
    owner_id = user["sub"]
    with get_db_ctx() as conn:
        try:
            return submit_review_sqlite(node_id, owner_id, payload.rating, conn)
        except Exception as e:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@app.get("/review-stats")
def review_stats_endpoint(user: dict = Depends(get_current_user)):
    owner_id = user["sub"]
    with get_db_ctx() as conn:
        try:
            return get_review_stats_sqlite(owner_id, conn)
        except Exception as e:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
