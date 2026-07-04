"""Domain service: turn text into WAV bytes using the loaded IndicF5 model and
the server-side reference voice + transcript.

Inference is serialized with a lock (the model is not guaranteed thread-safe)
and cleanup is guaranteed via finally (skills.md defensive coding).
"""
from __future__ import annotations

import io
import os
import threading

import numpy as np
import soundfile as sf

from app.core.config import get_settings
from app.core.logging import logger
from app.services.model_loader import model_loader

_inference_lock = threading.Lock()


class ReferenceVoiceError(RuntimeError):
    """Raised when the server-side reference voice is missing/misconfigured."""


def _to_float32(audio: np.ndarray) -> np.ndarray:
    if audio.dtype == np.int16:
        return audio.astype(np.float32) / 32768.0
    return np.asarray(audio, dtype=np.float32)


def synthesize(text: str) -> tuple[bytes, int]:
    """Return (wav_bytes, duration_ms). Raises on model/reference failures."""
    settings = get_settings()
    ref_path = settings.reference_audio_path
    ref_text = settings.reference_text or ""

    if not ref_path or not os.path.isfile(ref_path):
        raise ReferenceVoiceError(f"Reference audio not found at {ref_path!r}.")

    model = model_loader.get()

    acquired = _inference_lock.acquire(timeout=settings.request_timeout_seconds)
    if not acquired:
        raise TimeoutError("Timed out waiting for the inference lock.")
    try:
        raw = model(text, ref_audio_path=ref_path, ref_text=ref_text)
        audio = _to_float32(np.asarray(raw))

        buffer = io.BytesIO()
        sf.write(buffer, audio, samplerate=settings.sample_rate, format="WAV")
        wav_bytes = buffer.getvalue()

        num_samples = int(audio.shape[0]) if audio.ndim >= 1 else 0
        duration_ms = int(round((num_samples / settings.sample_rate) * 1000)) if num_samples else 0
        logger.info("Synthesized %d bytes (%d ms).", len(wav_bytes), duration_ms)
        return wav_bytes, duration_ms
    finally:
        _inference_lock.release()
