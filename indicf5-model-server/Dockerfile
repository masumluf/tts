# indicf5-model-server — Dockerized IndicF5 TTS server.
# Loads the model once at startup; exposes GET /health and POST /v1/tts/generate.
# CPU image by default; switch the torch install for a CUDA base if using GPU.

FROM python:3.11-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HF_HOME=/app/hf_home

# System deps: git (to pip-install IndicF5 from GitHub), libsndfile for
# soundfile, ffmpeg for audio handling, curl for the healthcheck.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git libsndfile1 ffmpeg curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt constraints.txt ./
# The constraints file forces the CPU-only torch/torchaudio for all packages
# (incl. transitive deps pulled by the IndicF5 git install), preventing the
# CUDA torchaudio wheel from sneaking in on a CPU-only host.
RUN pip install --no-cache-dir -c constraints.txt -r requirements.txt

COPY app ./app
COPY reference ./reference

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=5 \
  CMD curl -fsS http://localhost:8000/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
