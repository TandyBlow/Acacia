import os
import pytest
from httpx import ASGITransport, AsyncClient

# Use a test database so we don't touch the real one
os.environ["DB_PATH"] = os.path.join(os.path.dirname(__file__), "test_acacia.db")

from main import app
from database import init_db, get_db_ctx


@pytest.fixture(autouse=True)
def clean_db():
    """Re-initialize the test database before each test."""
    db_path = os.environ["DB_PATH"]
    if os.path.exists(db_path):
        os.remove(db_path)
    init_db()
    yield
    if os.path.exists(db_path):
        os.remove(db_path)


async def _register_and_login(client: AsyncClient) -> str:
    """Helper: register a test user and return a JWT token."""
    resp = await client.post("/auth/register", json={
        "username": "testuser",
        "password": "testpass123",
    })
    assert resp.status_code in (200, 201), f"Register failed: {resp.text}"
    data = resp.json()
    # register may return the user directly or a token
    if "token" in data:
        return data["token"]
    # Otherwise login explicitly
    resp = await client.post("/auth/login", json={
        "username": "testuser",
        "password": "testpass123",
    })
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    return resp.json()["token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_post_node_creates_node_and_get_tree_includes_it():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        token = await _register_and_login(client)

        create_resp = await client.post(
            "/nodes",
            json={"name": "Root", "parent_id": None, "content": "hello"},
            headers=_auth(token),
        )
        assert create_resp.status_code == 200, f"Create failed: {create_resp.text}"
        created = create_resp.json()
        assert created["id"]
        assert created["name"] == "Root"
        assert created["parentId"] is None

        # GET /tree returns the user's full tree including the new node
        tree_resp = await client.get("/tree", headers=_auth(token))
        assert tree_resp.status_code == 200
        tree = tree_resp.json()
        ids = [n["id"] for n in tree]
        assert created["id"] in ids


@pytest.mark.asyncio
async def test_get_node_context_missing_node_returns_null_nodeInfo():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        token = await _register_and_login(client)

        resp = await client.get(
            "/nodes/context/missing-id",
            headers=_auth(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["nodeInfo"] is None
        assert data["pathNodes"] == []


@pytest.mark.asyncio
async def test_delete_node_removes_node():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        token = await _register_and_login(client)

        create_resp = await client.post(
            "/nodes",
            json={"name": "To Delete"},
            headers=_auth(token),
        )
        assert create_resp.status_code == 200
        node_id = create_resp.json()["id"]

        # Soft-delete the node
        delete_resp = await client.delete(
            f"/nodes/{node_id}",
            headers=_auth(token),
        )
        assert delete_resp.status_code == 200

        # Node should no longer appear in the tree
        tree_resp = await client.get("/tree", headers=_auth(token))
        ids = [n["id"] for n in tree_resp.json()]
        assert node_id not in ids


@pytest.mark.asyncio
async def test_update_node_content():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        token = await _register_and_login(client)

        create_resp = await client.post(
            "/nodes",
            json={"name": "Note"},
            headers=_auth(token),
        )
        assert create_resp.status_code == 200
        node_id = create_resp.json()["id"]

        patch_resp = await client.patch(
            f"/nodes/{node_id}/content",
            json={"content": "updated content"},
            headers=_auth(token),
        )
        assert patch_resp.status_code == 200
        assert patch_resp.json()["ok"] is True


@pytest.mark.asyncio
async def test_unauthenticated_requests_return_401():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/nodes", json={"name": "X"})
        assert resp.status_code == 401
