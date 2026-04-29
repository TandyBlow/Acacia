import pytest
import logging
from unittest.mock import patch

from middleware.logging_middleware import LoggingMiddleware


@pytest.mark.asyncio
async def test_logs_request_fields(mock_scope, mock_receive, mock_send, caplog):
    """NF-06: Logging middleware emits all 5 fields."""
    mock_scope["method"] = "POST"
    mock_scope["path"] = "/api/test"
    mock_scope["headers"] = [(b"authorization", b"Bearer valid-token")]

    async def test_app(scope, receive, send):
        await send({
            "type": "http.response.start",
            "status": 200,
            "headers": [(b"content-type", b"application/json")],
        })
        await send({"type": "http.response.body", "body": b"{}"})

    caplog.set_level(logging.INFO, logger="acacia.request")

    with patch("middleware.logging_middleware.verify_token",
               return_value={"sub": "test-user-123", "username": "test"}):
        middleware = LoggingMiddleware(test_app)
        collector = type(mock_send)()
        await middleware(mock_scope, mock_receive(), collector)

    log_messages = " ".join(r.message for r in caplog.records)
    assert "method=POST" in log_messages, "should log method=POST"
    assert "path=/api/test" in log_messages, "should log path=/api/test"
    assert "status=200" in log_messages, "should log status=200"
    assert "duration_ms=" in log_messages, "should log duration_ms"
    assert "user=test-user-123" in log_messages, "should log user=test-user-123"
