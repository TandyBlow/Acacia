"""If-Match/ETag version protocol shared by content mutation endpoints.

Format follows RFC 9110: responses carry `ETag: "N"`; requests must echo the
version back as `If-Match: "N"`. A missing header is 428 (Precondition
Required), a stale version is 412 (Precondition Failed).
"""
from fastapi import HTTPException, Response, status


def etag_for(revision: int) -> str:
    return f'"{revision}"'


def set_etag(response: Response, revision: int) -> None:
    response.headers["ETag"] = etag_for(revision)


def parse_if_match(header_value: str) -> int:
    value = header_value.strip()
    if value.startswith("W/"):
        value = value[2:].strip()
    if len(value) >= 2 and value[0] == '"' and value[-1] == '"':
        value = value[1:-1]
    if not value.isdigit():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='If-Match must be a quoted version like "7"',
        )
    return int(value)


def require_if_match(header_value: str | None) -> int:
    if header_value is None or not header_value.strip():
        raise HTTPException(
            status_code=status.HTTP_428_PRECONDITION_REQUIRED,
            detail='Precondition Required: send If-Match with the version you are editing (ETag "N")',
        )
    return parse_if_match(header_value)


def ensure_matches(expected: int, current: int) -> None:
    if expected != current:
        raise HTTPException(
            status_code=status.HTTP_412_PRECONDITION_FAILED,
            detail=f"Version mismatch: you are editing version {expected}, the server has version {current}",
        )
