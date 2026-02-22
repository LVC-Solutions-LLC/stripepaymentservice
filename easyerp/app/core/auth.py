from fastapi import Header, HTTPException

from app.core.config import settings


def validate_api_key(authorization: str | None = Header(default=None)) -> None:
    # Matches existing Odoo integrations where Authorization is passed by callers.
    if not settings.api_key:
        return
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header is required")

    token = authorization.replace("Bearer", "").strip()
    if token != settings.api_key:
        raise HTTPException(status_code=401, detail="Invalid API key")
