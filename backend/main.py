from uuid import uuid4

from fastapi import FastAPI, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict


app = FastAPI()


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
def delete_node(node_id: str) -> Response:
    if node_id not in _nodes:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")
    del _nodes[node_id]
    return Response(status_code=status.HTTP_204_NO_CONTENT)
