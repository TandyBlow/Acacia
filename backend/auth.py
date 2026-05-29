"""
JWT authentication for local deployment.
"""
import jwt
import bcrypt
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

def _load_jwt_secret() -> str:
    """Load JWT secret from env, file, or auto-generate and persist."""
    secret = os.getenv("JWT_SECRET")
    if secret:
        return secret

    secret_file = os.getenv("JWT_SECRET_FILE") or os.path.join(os.path.dirname(__file__), ".jwt_secret")
    try:
        with open(secret_file) as f:
            return f.read().strip()
    except FileNotFoundError:
        secret = secrets.token_urlsafe(64)
        with open(secret_file, "w") as f:
            f.write(secret)
        return secret

JWT_SECRET = _load_jwt_secret()
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = 7


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def create_token(user_id: str, username: str) -> str:
    payload = {
        "sub": user_id,
        "username": username,
        "exp": datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRE_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def verify_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        return None
