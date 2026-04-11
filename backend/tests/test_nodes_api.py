import pytest
from httpx import ASGITransport, AsyncClient

from main import app
from main import _nodes as nodes_store


@pytest.fixture(autouse=True)
def clear_nodes_store():
    nodes_store.clear()


@pytest.mark.asyncio
async def test_post_nodes_creates_node_and_get_returns_it():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        create_response = await client.post(
            "/nodes",
            json={"name": "Root", "parent_id": None, "content": "hello"},
        )

        assert create_response.status_code == 201
        created = create_response.json()
        assert created["id"]
        assert created["name"] == "Root"
        assert created["parent_id"] is None
        assert created["content"] == "hello"

        get_response = await client.get(f"/nodes/{created['id']}")

        assert get_response.status_code == 200
        assert get_response.json() == created


@pytest.mark.asyncio
async def test_get_nodes_by_id_returns_404_for_missing_node():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/nodes/missing-id")

    assert response.status_code == 404
    assert response.json()["detail"] == "Node not found"


@pytest.mark.asyncio
async def test_delete_nodes_by_id_removes_node_and_returns_404_afterward():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        create_response = await client.post("/nodes", json={"name": "To Delete"})
        node_id = create_response.json()["id"]

        delete_response = await client.delete(f"/nodes/{node_id}")
        assert delete_response.status_code == 204
        assert delete_response.text == ""

        get_after_delete = await client.get(f"/nodes/{node_id}")
        assert get_after_delete.status_code == 404
