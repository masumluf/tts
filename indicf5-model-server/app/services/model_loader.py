"""Loads the IndicF5 model exactly once at process startup and holds the
singleton for reuse across requests (plan.md: "Loads IndicF5 once at startup").

Confirmed against the official model card (huggingface.co/ai4bharat/IndicF5):
    model = AutoModel.from_pretrained("ai4bharat/IndicF5", trust_remote_code=True)
    audio = model(text, ref_audio_path=..., ref_text=...)   # ~24 kHz output
"""
from __future__ import annotations

from typing import Any

from app.core.config import get_settings
from app.core.logging import logger


class ModelLoader:
    def __init__(self) -> None:
        self._model: Any | None = None

    def load(self) -> None:
        """Load the model once. Safe to call again (no-op if already loaded)."""
        if self._model is not None:
            return
        settings = get_settings()
        logger.info("Loading IndicF5 model '%s' on %s ...", settings.model_id, settings.model_device)

        # Imported lazily so the module (and tests) can import without torch.
        from transformers import AutoModel  # type: ignore[import-untyped]

        model = AutoModel.from_pretrained(settings.model_id, trust_remote_code=True)

        # Best-effort device placement; the custom model may manage this itself.
        try:
            to_device = getattr(model, "to", None)
            if settings.model_device != "cpu" and callable(to_device):
                model = to_device(settings.model_device)
        except Exception as exc:  # pragma: no cover - device placement is best-effort
            logger.warning("Could not move model to %s: %s", settings.model_device, exc)

        self._model = model
        logger.info("IndicF5 model loaded.")

    @property
    def is_loaded(self) -> bool:
        return self._model is not None

    def get(self) -> Any:
        if self._model is None:
            raise RuntimeError("Model is not loaded yet.")
        return self._model


model_loader = ModelLoader()
