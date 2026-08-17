# syntax=docker/dockerfile:1.7
# Bedrock AgentCore Runtime container for slidev-agent.
# Target platform must be linux/arm64 (Graviton) and the app must listen on :8080.

FROM --platform=linux/arm64 public.ecr.aws/docker/library/python:3.13-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# --- builder ---------------------------------------------------------------
FROM base AS builder
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && pip install --no-cache-dir uv

COPY pyproject.toml uv.lock* README.md ./
COPY src ./src
RUN uv sync --frozen --no-dev || uv pip install --system .

# --- runtime ---------------------------------------------------------------
FROM base AS runtime
WORKDIR /app

# Copy installed Python packages and source from the builder stage
COPY --from=builder /usr/local/lib/python3.13 /usr/local/lib/python3.13
COPY --from=builder /usr/local/bin /usr/local/bin
COPY --from=builder /app/src ./src

# Bedrock AgentCore expects port 8080
EXPOSE 8080

# AgentCore entrypoint (BedrockAgentCoreApp.run() listens on :8080)
ENV PYTHONPATH=/app/src
CMD ["python", "-m", "slidev_agent.runtime"]
