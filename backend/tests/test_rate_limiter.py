import pytest
import sqlite3
import os
import tempfile
from unittest.mock import patch

from middleware.rate_limit_middleware import (
    RateLimitMiddleware,
    GLOBAL_LIMIT,
    LOGIN_LIMIT,
    LLM_LIMIT,
    LOGIN_WINDOW,
    GLOBAL_WINDOW,
    LLM_WINDOW,
    LLM_PATHS,
)


@pytest.fixture(autouse=True)
def setup_rate_limits_table():
    """Ensure rate_limits table exists in the real DB for rate limiter tests.
    Also clear rate_limits data before each test for isolation."""
    from database import get_db_ctx
    with get_db_ctx() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS rate_limits (
                ip TEXT NOT NULL,
                endpoint TEXT NOT NULL,
                count INTEGER NOT NULL DEFAULT 0,
                window_start TEXT NOT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_rate_limits_ip_endpoint ON rate_limits(ip, endpoint)")
        conn.execute("DELETE FROM rate_limits")


@pytest.mark.asyncio
async def test_login_rate_limit_blocks_after_5_failures(mock_scope, mock_receive, mock_send):
    """NF-01: 6th failed login attempt returns 429 with Chinese message."""
    mock_scope["method"] = "POST"
    mock_scope["path"] = "/auth/login"

    async def login_app(scope, receive, send):
        await send({
            "type": "http.response.start",
            "status": 401,
            "headers": [(b"content-type", b"application/json")],
        })
        await send({"type": "http.response.body", "body": b'{"detail":"Invalid"}'})

    middleware = RateLimitMiddleware(login_app)

    # 5 failed logins should NOT be blocked
    for i in range(5):
        collector = type(mock_send)()
        await middleware(mock_scope, mock_receive(), collector)
        assert collector.status != 429, f"Request {i+1} should not be rate limited, got {collector.status}"

    # 6th request should be blocked
    collector = type(mock_send)()
    await middleware(mock_scope, mock_receive(), collector)
    assert collector.status == 429, f"6th request should be 429, got {collector.status}"
    chinese_msg = "登录尝试过多".encode("utf-8")
    assert any(chinese_msg in msg.get("body", b"") for msg in collector.messages), (
        "429 should contain Chinese error message"
    )


@pytest.mark.asyncio
async def test_login_success_resets_counter(mock_scope, mock_receive, mock_send):
    """NF-02: Successful login does NOT increment the failed counter.
    Counter stays at 3 after success, then 2 more failures reach limit (5)."""
    mock_scope["method"] = "POST"
    mock_scope["path"] = "/auth/login"
    request_count = [0]

    async def mixed_login_app(scope, receive, send):
        request_count[0] += 1
        if request_count[0] == 4:
            status = 200
            body = b'{"token":"ok"}'
        else:
            status = 401
            body = b'{"detail":"Invalid"}'
        await send({
            "type": "http.response.start",
            "status": status,
            "headers": [(b"content-type", b"application/json")],
        })
        await send({"type": "http.response.body", "body": body})

    middleware = RateLimitMiddleware(mixed_login_app)

    # 3 failed attempts (counter = 3)
    for _ in range(3):
        collector = type(mock_send)()
        await middleware(mock_scope, mock_receive(), collector)

    # 1 successful login — does NOT increment counter (stays at 3)
    collector = type(mock_send)()
    await middleware(mock_scope, mock_receive(), collector)
    assert collector.status == 200

    # 2 more failed attempts (counter = 5) should NOT trigger rate limit
    for i in range(2):
        collector = type(mock_send)()
        await middleware(mock_scope, mock_receive(), collector)
        assert collector.status != 429, (
            f"Failed login {i+1} after success should not trigger rate limit (counter at {3+i})"
        )

    # 6th failed attempt overall (counter = 5 >= 5) SHOULD trigger rate limit
    collector = type(mock_send)()
    await middleware(mock_scope, mock_receive(), collector)
    assert collector.status == 429, "6th failed attempt should trigger rate limit"


@pytest.mark.asyncio
async def test_global_rate_limit_blocks_after_100(mock_scope, mock_receive, mock_send):
    """NF-03: 101st request in 60s window returns 429."""
    mock_scope["method"] = "GET"
    mock_scope["path"] = "/health"

    async def echo_app(scope, receive, send):
        await send({
            "type": "http.response.start",
            "status": 200,
            "headers": [(b"content-type", b"application/json")],
        })
        await send({"type": "http.response.body", "body": b"{}"})

    middleware = RateLimitMiddleware(echo_app)

    # 100 requests should succeed
    for i in range(100):
        collector = type(mock_send)()
        await middleware(mock_scope, mock_receive(), collector)
        assert collector.status == 200, f"Request {i+1}: expected 200, got {collector.status}"

    # 101st should be blocked
    collector = type(mock_send)()
    await middleware(mock_scope, mock_receive(), collector)
    assert collector.status == 429, f"101st request should be 429, got {collector.status}"


@pytest.mark.asyncio
async def test_llm_rate_limit_blocks_after_10(mock_scope, mock_receive, mock_send):
    """NF-04: 11th LLM request returns 429, tracked by user_id."""
    mock_scope["method"] = "POST"
    mock_scope["path"] = "/ai-generate-nodes"
    mock_scope["headers"] = [(b"authorization", b"Bearer valid-token")]

    async def llm_app(scope, receive, send):
        await send({
            "type": "http.response.start",
            "status": 200,
            "headers": [(b"content-type", b"application/json")],
        })
        await send({"type": "http.response.body", "body": b'{"nodes":[]}'})

    with patch("middleware.rate_limit_middleware.verify_token",
               return_value={"sub": "test-llm-user", "username": "test"}):
        middleware = RateLimitMiddleware(llm_app)

        for i in range(10):
            collector = type(mock_send)()
            await middleware(mock_scope, mock_receive(), collector)
            assert collector.status == 200, f"LLM request {i+1}: expected 200, got {collector.status}"

        collector = type(mock_send)()
        await middleware(mock_scope, mock_receive(), collector)
        assert collector.status == 429, f"11th LLM request should be 429, got {collector.status}"


@pytest.mark.asyncio
async def test_fail_open_on_db_error(mock_scope, mock_receive, mock_send):
    """NF-05: DB error does not block legitimate requests (fail-open)."""
    mock_scope["method"] = "GET"
    mock_scope["path"] = "/health"

    async def health_app(scope, receive, send):
        await send({
            "type": "http.response.start",
            "status": 200,
            "headers": [(b"content-type", b"application/json")],
        })
        await send({"type": "http.response.body", "body": b'{"status":"ok"}'})

    with patch("middleware.rate_limit_middleware.get_db_ctx",
               side_effect=sqlite3.OperationalError("disk I/O error")):
        middleware = RateLimitMiddleware(health_app)
        collector = type(mock_send)()
        await middleware(mock_scope, mock_receive(), collector)
        assert collector.status == 200, f"Should fail open (200), got {collector.status}"
