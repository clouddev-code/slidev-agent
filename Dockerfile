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

COPY pyproject.toml uv.lock* ./
COPY src ./src
# Install locked deps into the system interpreter so the runtime stage's
# /usr/local copy picks them up (the project itself runs from PYTHONPATH).
RUN uv export --frozen --no-dev --no-emit-project -o requirements.txt \
 && uv pip install --system -r requirements.txt

# --- slidev (toolchain for the web preview build) ---------------------------
FROM --platform=linux/arm64 public.ecr.aws/docker/library/node:22-slim AS slidev
WORKDIR /opt/slidev
COPY slidev/package.json slidev/package-lock.json slidev/.npmrc ./
RUN npm ci

# --- runtime ---------------------------------------------------------------
FROM base AS runtime
WORKDIR /app

# Node.js + Slidev for `slidev build` (see src/slidev_agent/site_builder.py)
RUN apt-get update \
 && apt-get install -y --no-install-recommends libstdc++6 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=slidev /usr/local/bin/node /usr/local/bin/node
COPY --from=slidev /opt/slidev /opt/slidev

# Copy installed Python packages and source from the builder stage
COPY --from=builder /usr/local/lib/python3.13 /usr/local/lib/python3.13
COPY --from=builder /usr/local/bin /usr/local/bin
COPY --from=builder /app/src ./src

# Bedrock AgentCore expects port 8080
EXPOSE 8080

# AgentCore entrypoint (BedrockAgentCoreApp.run() listens on :8080)
ENV PYTHONPATH=/app/src
CMD ["python", "-m", "slidev_agent.runtime"]
