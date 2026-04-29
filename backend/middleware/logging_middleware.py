import time
import logging
from auth import verify_token

logger = logging.getLogger("acacia.request")
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter(
        "%(asctime)s %(levelname)s %(name)s %(message)s"
    ))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


class LoggingMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        start_time = time.time()
        method = scope.get("method", "UNKNOWN")
        path = scope.get("path", "/")
        user_id = self._extract_user_id(scope)
        response_status = 0

        async def wrapped_send(message):
            nonlocal response_status
            if message["type"] == "http.response.start":
                response_status = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, wrapped_send)
        finally:
            duration_ms = round((time.time() - start_time) * 1000, 2)
            logger.info(
                "method=%s path=%s status=%s duration_ms=%s user=%s",
                method, path, response_status, duration_ms, user_id,
            )

    def _extract_user_id(self, scope) -> str:
        for header_name, header_value in scope.get("headers", []):
            if header_name == b"authorization":
                token_str = header_value.decode("utf-8", errors="replace")
                if token_str.startswith("Bearer "):
                    token = token_str[7:]
                    payload = verify_token(token)
                    if payload and "sub" in payload:
                        return payload["sub"]
                break
        return "anonymous"
