"""Request schema for the TTS generate endpoint (response is a binary WAV)."""
from pydantic import BaseModel, Field


class GenerateRequest(BaseModel):
    job_id: str = Field(..., min_length=1, description="Correlation id from the caller.")
    text: str = Field(..., min_length=1, description="Text to synthesize.")
