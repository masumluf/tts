"""POST /v1/tts/generate — synthesize Bengali speech (returns binary WAV).

Guarded by X-Internal-Token. Uses the server-side reference voice + transcript.
Blocking inference runs in a threadpool so the event loop is not blocked.
"""
from fastapi import APIRouter, Depends, HTTPException, Response, status
from starlette.concurrency import run_in_threadpool

from app.api.dependencies import require_internal_token
from app.core.config import get_settings
from app.core.logging import logger
from app.schemas.tts import GenerateRequest
from app.services.model_loader import model_loader
from app.services.tts_service import ReferenceVoiceError, synthesize

router = APIRouter(prefix="/v1/tts", dependencies=[Depends(require_internal_token)])


@router.post("/generate")
async def generate(request: GenerateRequest) -> Response:
    settings = get_settings()

    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="text must not be empty.")
    if len(text) > settings.max_text_length:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"text exceeds the maximum length of {settings.max_text_length}.",
        )

    if not model_loader.is_loaded:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Model is not ready yet.",
        )

    try:
        wav_bytes, duration_ms = await run_in_threadpool(synthesize, text)
    except ReferenceVoiceError as exc:
        logger.error("Reference voice misconfigured for job %s: %s", request.job_id, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server voice configuration error.",
        ) from exc
    except Exception as exc:  # noqa: BLE001 - normalize all model errors to 500
        logger.exception("Synthesis failed for job %s", request.job_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Audio generation failed.",
        ) from exc

    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={
            "Content-Disposition": f'attachment; filename="{request.job_id}.wav"',
            "X-Audio-Duration-Ms": str(duration_ms),
        },
    )
