"""FastAPI application entrypoint for the IndicF5 model server.

Lifespan loads the model once at startup. Internal-only service reached by the
tts-api-service worker over HTTP.
"""
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI

from app.api.routes import health, tts
from app.core.logging import logger
from app.services.model_loader import model_loader


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    try:
        model_loader.load()
    except Exception:  # noqa: BLE001 - log but let /health report not-ready
        logger.exception("Model failed to load at startup")
    yield


app = FastAPI(title="indicf5-model-server", version="0.1.0", lifespan=lifespan)
app.include_router(health.router)
app.include_router(tts.router)
