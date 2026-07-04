"""FastAPI dependencies: internal-token auth.

Validates `X-Internal-Token` against the configured secret using a constant-time
comparison. Missing/invalid -> 401/403. Applied to every non-health route.
"""
import secrets

from fastapi import Header, HTTPException, status

from app.core.config import get_settings


async def require_internal_token(x_internal_token: str | None = Header(default=None)) -> None:
    if x_internal_token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-Internal-Token header.",
        )
    expected = get_settings().internal_token
    if not secrets.compare_digest(x_internal_token, expected):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid internal token.",
        )
