import time
import logging
from calendar import timegm
from database import get_db_ctx
from auth import verify_token

logger = logging.getLogger("acacia.ratelimit")

GLOBAL_LIMIT = 100
GLOBAL_WINDOW = 60
LOGIN_LIMIT = 5
LOGIN_WINDOW = 900
LLM_LIMIT = 10
LLM_WINDOW = 60
LLM_PATHS = frozenset({
    "/ai-generate-nodes",
    "/analyze-node",
    "/generate-question",
    "/generate-batch",
})
CLEANUP_INTERVAL = 100


class RateLimitMiddleware:
    def __init__(self, app):
        self.app = app
        self._request_count = 0

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "/")
        ip = self._get_ip(scope)
        now = time.time()

        if path == "/auth/login":
            if not self._check_rate_limit(ip, "login_failed", LOGIN_LIMIT, LOGIN_WINDOW):
                await self._send_429(send, "登录尝试过多，请15分钟后再试")
                return

        if not self._check_rate_limit(ip, "global", GLOBAL_LIMIT, GLOBAL_WINDOW):
            await self._send_429(send, "请求过于频繁，请稍后再试")
            return

        is_llm = any(path.startswith(p) for p in LLM_PATHS)
        llm_blocked = False
        if is_llm:
            user_id = self._extract_user_id(scope)
            llm_blocked = not self._check_rate_limit(user_id, "llm", LLM_LIMIT, LLM_WINDOW)
            if llm_blocked:
                await self._send_429(send, "AI请求过于频繁，请稍后再试")
                return

        response_status = 0

        async def wrapped_send(message):
            nonlocal response_status
            if message["type"] == "http.response.start":
                response_status = message["status"]
            await send(message)

        await self.app(scope, receive, wrapped_send)

        self._increment_rate_limit(ip, "global", GLOBAL_WINDOW)
        if is_llm:
            user_id = self._extract_user_id(scope)
            self._increment_rate_limit(user_id, "llm", LLM_WINDOW)
        if path == "/auth/login" and response_status == 401:
            self._increment_rate_limit(ip, "login_failed", LOGIN_WINDOW)

        self._request_count += 1
        if self._request_count % CLEANUP_INTERVAL == 0:
            self._cleanup_expired()

    def _get_ip(self, scope) -> str:
        client = scope.get("client")
        return client[0] if client else "unknown"

    def _extract_user_id(self, scope) -> str:
        for header_name, header_value in scope.get("headers", []):
            if header_name == b"authorization":
                token = header_value.decode("utf-8")
                if token.startswith("Bearer "):
                    token = token[7:]
                payload = verify_token(token)
                if payload:
                    return payload.get("sub", "unknown")
        return self._get_ip(scope)

    def _check_rate_limit(self, key: str, endpoint: str, limit: int, window: int) -> bool:
        try:
            with get_db_ctx() as conn:
                row = conn.execute(
                    "SELECT count, window_start FROM rate_limits WHERE ip=? AND endpoint=?",
                    (key, endpoint),
                ).fetchone()
                if row:
                    window_start = self._parse_iso(row["window_start"])
                    if (time.time() - window_start) > window:
                        now_iso = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())
                        conn.execute(
                            "UPDATE rate_limits SET count=1, window_start=? WHERE ip=? AND endpoint=?",
                            (now_iso, key, endpoint),
                        )
                        return True
                    if row["count"] >= limit:
                        return False
                return True
        except Exception as e:
            logger.error("rate_limit_check_failed key=%s endpoint=%s error=%s", key, endpoint, str(e))
            return True

    def _increment_rate_limit(self, key: str, endpoint: str, window: int):
        try:
            with get_db_ctx() as conn:
                now_iso = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())
                row = conn.execute(
                    "SELECT count, window_start FROM rate_limits WHERE ip=? AND endpoint=?",
                    (key, endpoint),
                ).fetchone()
                if row and (time.time() - self._parse_iso(row["window_start"])) <= window:
                    conn.execute(
                        "UPDATE rate_limits SET count=count+1 WHERE ip=? AND endpoint=?",
                        (key, endpoint),
                    )
                else:
                    conn.execute(
                        "INSERT OR REPLACE INTO rate_limits (ip, endpoint, count, window_start) "
                        "VALUES (?, ?, 1, ?)",
                        (key, endpoint, now_iso),
                    )
        except Exception as e:
            logger.error("rate_limit_increment_failed key=%s endpoint=%s error=%s", key, endpoint, str(e))

    def _cleanup_expired(self):
        try:
            with get_db_ctx() as conn:
                conn.execute(
                    "DELETE FROM rate_limits WHERE window_start < datetime('now', '-15 minutes')"
                )
        except Exception as e:
            logger.error("rate_limit_cleanup_failed error=%s", str(e))

    async def _send_429(self, send, detail: str):
        body = '{"detail":"' + detail + '"}'
        await send({
            "type": "http.response.start",
            "status": 429,
            "headers": [
                (b"content-type", b"application/json; charset=utf-8"),
                (b"content-length", str(len(body)).encode()),
            ],
        })
        await send({
            "type": "http.response.body",
            "body": body.encode("utf-8"),
        })

    @staticmethod
    def _parse_iso(iso_str: str) -> float:
        return timegm(time.strptime(iso_str, "%Y-%m-%dT%H:%M:%S"))
