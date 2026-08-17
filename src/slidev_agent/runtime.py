"""AgentCore Runtime entrypoint for Slidev Agent (multi-agent Graph).

Runs the Strands Graph (planner→researcher→writer→validator) inside
`BedrockAgentCoreApp`. Streams multi-agent events back to the caller as
SSE so the Lambda glue can persist progress to AppSync `SlideJob.logs`.
"""

from __future__ import annotations

import json
import os
from typing import Any

from bedrock_agentcore.runtime import BedrockAgentCoreApp

from .agent import (
    SlidevAgentConfig,
    _writer_invocation_state,
    build_graph_seed_prompt,
    create_slidev_graph,
)

app = BedrockAgentCoreApp()


def _resolve_output_path(payload: dict[str, Any], job_id: str) -> str:
    """Resolve the writer output path.

    Priority:
      1. `payload["output_path"]` (caller-supplied; AppSync Lambda passes the
         exact S3 URI it wants).
      2. `s3://$SLIDES_BUCKET/jobs/{job_id}/slides.md` if SLIDES_BUCKET is set.
      3. `./output/slides.md` for local dev.
    """
    if payload.get("output_path"):
        return str(payload["output_path"])
    bucket = os.getenv("SLIDES_BUCKET")
    if bucket:
        return f"s3://{bucket}/jobs/{job_id}/slides.md"
    return "./output/slides.md"


def _build_config(payload: dict[str, Any], context: Any) -> SlidevAgentConfig:
    topic = payload.get("topic")
    if not topic:
        raise ValueError("'topic' is required in payload")

    job_id = (
        payload.get("job_id")
        or getattr(context, "session_id", None)
        or "local"
    )

    return SlidevAgentConfig(
        topic=topic,
        num_slides=int(payload.get("num_slides", 10)),
        style=payload.get("style", "technical"),
        theme=payload.get("theme", "penguin"),
        language=payload.get("language", "ja"),
        output_path=_resolve_output_path(payload, job_id),
    )


def _serialize_event(event: Any) -> dict[str, Any]:
    """Convert a Strands multi-agent event into a JSON-serialisable dict."""
    if isinstance(event, dict):
        out: dict[str, Any] = {}
        for k, v in event.items():
            try:
                json.dumps(v)
                out[k] = v
            except TypeError:
                out[k] = str(v)
        return out
    return {"raw": str(event)}


@app.entrypoint
async def invoke(payload: dict[str, Any], context: Any):
    """AgentCore entrypoint.

    Yields a stream of events; each event is one of:
      - {"type": "node_start", "node_id": "..."}
      - {"type": "node_text",  "node_id": "...", "text": "..."}
      - {"type": "node_done",  "node_id": "...", "duration_ms": ...}
      - {"type": "result",     "status": "...", "output_path": "..."}
      - {"type": "error",      "message": "..."}
    """
    try:
        config = _build_config(payload, context)
    except ValueError as e:
        yield {"type": "error", "message": str(e)}
        return

    try:
        graph = create_slidev_graph(config)
        seed = build_graph_seed_prompt(config)
        invocation_state = _writer_invocation_state(config)

        async for event in graph.stream_async(seed, invocation_state=invocation_state):
            etype = event.get("type") if isinstance(event, dict) else None

            if etype == "multiagent_node_start":
                yield {
                    "type": "node_start",
                    "node_id": event.get("node_id"),
                }
            elif etype == "multiagent_node_stream":
                inner = event.get("event", {}) or {}
                # Forward any text deltas. Different SDK versions emit
                # `data` (raw text) or {"contentBlockDelta": {...}}.
                text = inner.get("data")
                if not text and isinstance(inner.get("delta"), dict):
                    text = inner["delta"].get("text")
                if text:
                    yield {
                        "type": "node_text",
                        "node_id": event.get("node_id"),
                        "text": str(text)[:1000],
                    }
            elif etype == "multiagent_node_stop":
                node_result = event.get("node_result")
                duration = getattr(node_result, "execution_time", None)
                yield {
                    "type": "node_done",
                    "node_id": event.get("node_id"),
                    "duration_ms": duration,
                }
            elif etype == "multiagent_result":
                result = event.get("result")
                status = getattr(result, "status", None)
                yield {
                    "type": "result",
                    "status": str(status) if status is not None else "completed",
                    "output_path": config.output_path,
                }
            else:
                yield _serialize_event(event)
    except Exception as e:  # pragma: no cover - defensive
        yield {"type": "error", "message": str(e)}


if __name__ == "__main__":
    app.run()
