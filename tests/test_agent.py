"""Tests for the model factory."""

import os
from unittest.mock import patch

TOOL_SPEC = {
    "name": "write_slidev_markdown",
    "description": "Write slides",
    "inputSchema": {"json": {"type": "object", "properties": {}}},
}
MESSAGES = [{"role": "user", "content": [{"text": "スライドを作って"}]}]


class TestPromptCaching:
    """Claude requests carry cache points on system, tools and the last user turn."""

    def test_anthropic_request_has_cache_control(self):
        from slidev_agent.agent import _anthropic_model, create_model

        _anthropic_model.cache_clear()
        env = {"MODEL_PROVIDER": "anthropic", "ANTHROPIC_API_KEY": "sk-ant-test"}
        with patch.dict(os.environ, env):
            os.environ.pop("ANTHROPIC_FEDERATION_RULE_ID", None)
            model = create_model()
        _anthropic_model.cache_clear()

        request = model.format_request(MESSAGES, [TOOL_SPEC], system_prompt="You are a writer.")

        assert request["system"][-1]["cache_control"]["type"] == "ephemeral"
        assert request["tools"][-1]["cache_control"]["type"] == "ephemeral"
        assert request["messages"][-1]["content"][-1]["cache_control"]["type"] == "ephemeral"

    def test_bedrock_request_has_cache_points(self):
        from slidev_agent.agent import create_model

        env = {"BEDROCK_MODEL_ID": "us.anthropic.claude-opus-4-6-v1:0", "AWS_REGION": "us-east-1"}
        with patch.dict(os.environ, env):
            model = create_model("bedrock")

        request = model.format_request(
            MESSAGES, [TOOL_SPEC], system_prompt_content=[{"text": "You are a writer."}]
        )

        assert "cachePoint" in request["system"][-1]
        assert "cachePoint" in request["toolConfig"]["tools"][-1]
        assert "cachePoint" in request["messages"][-1]["content"][-1]
