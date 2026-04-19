from uuid import uuid4

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict

from tree_generator import generate_tree_visualization
from tree_repository import fetch_user_tree
from lsystem import generate_lsystem_skeleton
from tag_service import tag_all_nodes
from style_service import compute_style

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class NodeCreate(BaseModel):
    name: str
    parent_id: str | None = None
    content: str = ""


class Node(BaseModel):
    id: str
    name: str
    parent_id: str | None = None
    content: str = ""

    model_config = ConfigDict(from_attributes=True)


_nodes: dict[str, Node] = {}


@app.post("/nodes", response_model=Node, status_code=status.HTTP_201_CREATED)
def create_node(payload: NodeCreate) -> Node:
    node = Node(id=str(uuid4()), **payload.model_dump())
    _nodes[node.id] = node
    return node


@app.get("/nodes/{node_id}", response_model=Node)
def get_node(node_id: str) -> Node:
    node = _nodes.get(node_id)
    if node is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")
    return node


@app.delete("/nodes/{node_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_node(node_id: str) -> None:
    if node_id not in _nodes:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")
    del _nodes[node_id]


@app.post("/generate-tree/{user_id}")
def generate_tree(user_id: str) -> dict:
    """
    Generate L-system tree visualization for a user.

    Returns the public URL of the generated PNG.
    """
    try:
        png_url = generate_tree_visualization(user_id)
        return {"png_url": png_url}
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@app.post("/generate-tree-skeleton/{user_id}")
def generate_tree_skeleton(user_id: str) -> dict:
    """
    Generate L-system tree skeleton for a user.

    Returns skeleton JSON with branches (bezier coordinates, thickness, node_id).
    """
    try:
        tree_data = fetch_user_tree(user_id)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

    if not tree_data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"No tree data found for user {user_id}")

    return generate_lsystem_skeleton(tree_data)


@app.post("/tag-nodes/{user_id}")
def tag_nodes(user_id: str) -> dict:
    try:
        return tag_all_nodes(user_id)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@app.get("/style/{user_id}")
def get_style(user_id: str) -> dict:
    try:
        return compute_style(user_id)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
