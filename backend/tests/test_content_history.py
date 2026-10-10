"""Content history + ETag/If-Match version protocol.

Covers the protection added after the editor content-loss incidents: every
content update snapshots the previous version, restores are version-checked,
and stale pages can never overwrite newer server content.
"""
import pytest
from httpx import ASGITransport, AsyncClient

from main import app


async def _register_and_login(client: AsyncClient, username: str = "testuser") -> str:
    resp = await client.post("/auth/register", json={
        "username": username,
        "password": "testpass123",
    })
    assert resp.status_code in (200, 201), f"Register failed: {resp.text}"
    data = resp.json()
    if "token" in data:
        return data["token"]
    resp = await client.post("/auth/login", json={
        "username": username,
        "password": "testpass123",
    })
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    return resp.json()["token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _version(rev: int) -> dict:
    return {"If-Match": f'"{rev}"'}


async def _create_node(client: AsyncClient, token: str, name: str = "Note", content: str = "") -> str:
    # POST /nodes does not take content; give the node its text with a first
    # versioned save so tests start from a known (content, revision) pair.
    resp = await client.post(
        "/nodes",
        json={"name": name},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    node_id = resp.json()["id"]
    if content:
        resp = await client.patch(
            f"/nodes/{node_id}/content",
            json={"content": content},
            headers={**_auth(token), "If-Match": '"1"'},
        )
        assert resp.status_code == 200, resp.text
    return node_id


async def _save(client: AsyncClient, token: str, node_id: str, content: str, rev: int):
    return await client.patch(
        f"/nodes/{node_id}/content",
        json={"content": content},
        headers={**_auth(token), **_version(rev)},
    )


@pytest.mark.asyncio
async def test_update_without_if_match_returns_428():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        token = await _register_and_login(client)
        node_id = await _create_node(client, token)

        resp = await client.patch(
            f"/nodes/{node_id}/content",
            json={"content": "x"},
            headers=_auth(token),
        )
        assert resp.status_code == 428


@pytest.mark.asyncio
async def test_update_with_malformed_if_match_returns_400():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        token = await _register_and_login(client)
        node_id = await _create_node(client, token)

        resp = await client.patch(
            f"/nodes/{node_id}/content",
            json={"content": "x"},
            headers={**_auth(token), "If-Match": "not-a-version"},
        )
        assert resp.status_code == 400


@pytest.mark.asyncio
async def test_stale_if_match_returns_412_and_keeps_server_content():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        token = await _register_and_login(client)
        node_id = await _create_node(client, token, content="original")

        first = await _save(client, token, node_id, "second", rev=2)
        assert first.status_code == 200
        assert first.headers["etag"] == '"3"'

        # A page still holding version 2 must not overwrite version 3.
        stale = await _save(client, token, node_id, "stale overwrite", rev=2)
        assert stale.status_code == 412

        context = await client.get(f"/nodes/context/{node_id}", headers=_auth(token))
        assert context.json()["nodeInfo"]["content"] == "second"
        assert context.headers["etag"] == '"3"'


@pytest.mark.asyncio
async def test_successful_save_snapshots_previous_content():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        token = await _register_and_login(client)
        node_id = await _create_node(client, token, content="v1 text")

        resp = await _save(client, token, node_id, "v2 text", rev=2)
        assert resp.status_code == 200
        assert resp.json()["revision"] == 3

        history = await client.get(f"/nodes/{node_id}/content-history", headers=_auth(token))
        assert history.status_code == 200
        entries = history.json()
        assert len(entries) == 2  # the creation-era empty snapshot + "v1 text"
        assert entries[0]["preview"] == "v1 text"
        assert entries[0]["source"] == "save"
        assert entries[0]["pinned"] is False

        detail = await client.get(
            f"/nodes/{node_id}/content-history/{entries[0]['id']}", headers=_auth(token)
        )
        assert detail.status_code == 200
        assert detail.json()["content"] == "v1 text"


@pytest.mark.asyncio
async def test_unchanged_save_skips_history_and_revision_bump():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        token = await _register_and_login(client)
        node_id = await _create_node(client, token, content="same")

        resp = await _save(client, token, node_id, "same", rev=2)
        assert resp.status_code == 200
        body = resp.json()
        assert body["unchanged"] is True
        assert body["revision"] == 2

        history = await client.get(f"/nodes/{node_id}/content-history", headers=_auth(token))
        # Only the creation-era snapshot exists; the unchanged save added none.
        assert len(history.json()) == 1


@pytest.mark.asyncio
async def test_history_lists_newest_first():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        token = await _register_and_login(client)
        node_id = await _create_node(client, token, content="v1")

        for i in range(2, 5):
            resp = await _save(client, token, node_id, f"v{i}", rev=i)
            assert resp.status_code == 200

        history = await client.get(f"/nodes/{node_id}/content-history", headers=_auth(token))
        previews = [e["preview"] for e in history.json()]
        assert previews == ["v3", "v2", "v1", ""]


@pytest.mark.asyncio
async def test_restore_reverts_content_and_pins_pre_restore_version():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        token = await _register_and_login(client)
        node_id = await _create_node(client, token, content="good version")

        await _save(client, token, node_id, "truncated garbage", rev=2)

        history = await client.get(f"/nodes/{node_id}/content-history", headers=_auth(token))
        good_entry = next(e for e in history.json() if e["preview"] == "good version")

        restore = await client.post(
            f"/nodes/{node_id}/content-history/{good_entry['id']}/restore",
            headers={**_auth(token), **_version(3)},
        )
        assert restore.status_code == 200
        assert restore.headers["etag"] == '"4"'
        assert restore.json()["revision"] == 4

        context = await client.get(f"/nodes/context/{node_id}", headers=_auth(token))
        assert context.json()["nodeInfo"]["content"] == "good version"

        history = await client.get(f"/nodes/{node_id}/content-history", headers=_auth(token))
        entries = history.json()
        pinned = [e for e in entries if e["pinned"]]
        assert len(pinned) == 1
        assert pinned[0]["preview"] == "truncated garbage"
        assert pinned[0]["source"] == "restore-backup"

        # The pre-restore snapshot is intact and restorable in turn.
        detail = await client.get(
            f"/nodes/{node_id}/content-history/{pinned[0]['id']}", headers=_auth(token)
        )
        assert detail.json()["content"] == "truncated garbage"


@pytest.mark.asyncio
async def test_restore_requires_and_checks_version():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        token = await _register_and_login(client)
        node_id = await _create_node(client, token, content="v1")
        await _save(client, token, node_id, "v2", rev=2)

        history = await client.get(f"/nodes/{node_id}/content-history", headers=_auth(token))
        entry_id = history.json()[0]["id"]

        missing = await client.post(
            f"/nodes/{node_id}/content-history/{entry_id}/restore", headers=_auth(token)
        )
        assert missing.status_code == 428

        stale = await client.post(
            f"/nodes/{node_id}/content-history/{entry_id}/restore",
            headers={**_auth(token), **_version(5)},
        )
        assert stale.status_code == 412


@pytest.mark.asyncio
async def test_pruning_keeps_recent_and_spares_pinned():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        token = await _register_and_login(client)
        node_id = await _create_node(client, token, content="v0")

        # A restore pins the pre-restore content; 50 more saves then cap the
        # non-pinned history while the pinned snapshot survives.
        for i in range(1, 51):
            resp = await _save(client, token, node_id, f"v{i}", rev=i + 1)
            assert resp.status_code == 200

        history = await client.get(f"/nodes/{node_id}/content-history", headers=_auth(token))
        entry_id = history.json()[0]["id"]
        restore = await client.post(
            f"/nodes/{node_id}/content-history/{entry_id}/restore",
            headers={**_auth(token), **_version(52)},
        )
        assert restore.status_code == 200

        # 40 more saves: 51 non-pinned entries now, pruning must cap at 50.
        for i in range(52, 92):
            resp = await _save(client, token, node_id, f"v{i}", rev=i + 1)
            assert resp.status_code == 200

        history = await client.get(f"/nodes/{node_id}/content-history", headers=_auth(token))
        entries = history.json()
        non_pinned = [e for e in entries if not e["pinned"]]
        pinned = [e for e in entries if e["pinned"]]
        assert len(non_pinned) == 50
        assert len(pinned) == 1
        assert pinned[0]["preview"] == "v50"
        # Newest entry is the most recent save's previous content.
        assert non_pinned[0]["preview"] == "v90"


@pytest.mark.asyncio
async def test_history_is_invisible_to_other_users():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        token_a = await _register_and_login(client, "owner_user")
        token_b = await _register_and_login(client, "other_user")
        node_id = await _create_node(client, token_a, content="secret")
        await _save(client, token_a, node_id, "secret v2", rev=2)

        listed = await client.get(f"/nodes/{node_id}/content-history", headers=_auth(token_b))
        assert listed.status_code == 404

        history = await client.get(f"/nodes/{node_id}/content-history", headers=_auth(token_a))
        entry_id = history.json()[0]["id"]

        detail = await client.get(
            f"/nodes/{node_id}/content-history/{entry_id}", headers=_auth(token_b)
        )
        assert detail.status_code == 404

        restore = await client.post(
            f"/nodes/{node_id}/content-history/{entry_id}/restore",
            headers={**_auth(token_b), **_version(3)},
        )
        assert restore.status_code == 404


@pytest.mark.asyncio
async def test_reads_expose_revision_for_if_match():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        token = await _register_and_login(client)
        node_id = await _create_node(client, token, content="hello")

        context = await client.get(f"/nodes/context/{node_id}", headers=_auth(token))
        assert context.json()["nodeInfo"]["revision"] == 2
        assert context.headers["etag"] == '"2"'

        # The revision from the read is exactly what the next save must echo.
        resp = await _save(client, token, node_id, "hello v2", rev=2)
        assert resp.status_code == 200
