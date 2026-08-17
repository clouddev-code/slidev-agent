"""AG-UI protocol server for local Slidev Agent verification.

Wraps the legacy single-agent Slidev generator (`create_slidev_agent`) as an
AG-UI-compatible FastAPI app via `ag_ui_strands`, so a CopilotKit/Next.js
frontend can drive it over SSE for local testing.

This is separate from `runtime.py`, which exposes the multi-agent Graph
(planner -> researcher -> writer -> validator) to Bedrock AgentCore via
`BedrockAgentCoreApp`; `ag_ui_strands.StrandsAgent` wraps a single
`strands.Agent`, not a Graph, so this entrypoint uses the CLI's single-agent
path instead.

Run locally with:
    uv run uvicorn slidev_agent.agui_server:app --reload --port 8000
"""

from __future__ import annotations

from dotenv import load_dotenv

from ag_ui_strands import StrandsAgent, create_strands_app

from .agent import create_slidev_agent

load_dotenv()

strands_agent = create_slidev_agent()

agui_agent = StrandsAgent(
    agent=strands_agent,
    name="slidev-agent",
    description="Generates Slidev presentations from a topic via web research",
)

app = create_strands_app(agui_agent, "/")
