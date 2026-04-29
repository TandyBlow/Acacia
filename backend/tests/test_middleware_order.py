import pytest
import logging
from unittest.mock import patch
from middleware.logging_middleware import LoggingMiddleware
from middleware.rate_limit_middleware import RateLimitMiddleware


@pytest.mark.asyncio
async def test_429_responses_are_logged(caplog):
    """NF-11: Rate-limited 429 responses appear in request logs.

    Proves logging middleware wraps rate limiter: patches the rate
    limiter to return 429, then verifies the 429 status is logged.
    """
    caplog.set_level(logging.INFO, logger="acacia.request")

    async def app(scope, receive, send):
        await send({
            "type": "http.response.start",
            "status": 200,
            "headers": [(b"content-type", b"application/json")],
        })
        await send({"type": "http.response.body", "body": b"{}"})

    # Build the chain: logging -> rate-limit -> app
    with patch.object(RateLimitMiddleware, '_check_rate_limit', return_value=False):
        chained = LoggingMiddleware(RateLimitMiddleware(app))

        async def receive():
            return {"type": "http.request", "body": b""}

        class SendCollector:
            def __init__(self):
                self.status = 0
                self.messages = []

            async def __call__(self, message):
                self.messages.append(message)
                if message["type"] == "http.response.start":
                    self.status = message["status"]

        collector = SendCollector()
        scope = {
            "type": "http",
            "method": "GET",
            "path": "/health",
            "headers": [],
            "client": ("127.0.0.1", 54321),
        }

        await chained(scope, receive, collector)

    # Verify response was 429
    assert collector.status == 429, f"Expected 429, got {collector.status}"

    # Verify 429 was logged by logging middleware
    log_lines = [r.message for r in caplog.records if "status=429" in r.message]
    assert len(log_lines) > 0, (
        "No 429 responses in request log - logging middleware does not wrap rate limiter"
    )
