"""Typed application settings (pydantic-settings).

Single source of configuration; feature code reads from `get_settings()`,
never os.environ directly. The internal token is a secret and is never logged.
"""
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_host: str = Field(default="0.0.0.0", alias="APP_HOST")
    app_port: int = Field(default=8000, alias="APP_PORT")
    log_level: str = Field(default="info", alias="LOG_LEVEL")

    internal_token: str = Field(alias="INTERNAL_TOKEN")

    model_id: str = Field(default="ai4bharat/IndicF5", alias="MODEL_ID")
    model_device: str = Field(default="cpu", alias="MODEL_DEVICE")
    hf_home: str = Field(default="/app/hf_home", alias="HF_HOME")

    reference_audio_path: str = Field(alias="REFERENCE_AUDIO_PATH")
    reference_text: str = Field(alias="REFERENCE_TEXT")

    max_text_length: int = Field(default=5000, alias="MAX_TEXT_LENGTH")
    request_timeout_seconds: int = Field(default=120, alias="REQUEST_TIMEOUT_SECONDS")

    # Output sample rate is fixed by the IndicF5 model card.
    sample_rate: int = 24000


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
