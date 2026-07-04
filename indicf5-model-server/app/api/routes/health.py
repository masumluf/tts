"""GET /health — liveness + model-loaded status (no auth)."""
from fastapi import APIRouter

from app.services.model_loader import model_loader

router = APIRouter()


@router.get("/health")
async def health() -> dict[str, object]:
    return {"status": "ok", "model_loaded": model_loader.is_loaded}
