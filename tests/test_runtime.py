"""Tests for the runtime payload handling and Tavily key resolution."""

import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestParseNumSlides:
    @pytest.mark.parametrize(
        ("topic", "expected"),
        [
            ("Kubernetes入門を15枚で", 15),
            ("Kubernetes入門 １２枚", 12),
            ("生成AI入門 5 ページ", 5),
            ("Intro to Rust in 8 slides", 8),
            ("2026年のAWS re:Invent まとめ", None),
            ("100枚で", None),
            ("0枚", None),
        ],
    )
    def test_parse(self, topic, expected):
        from slidev_agent.runtime import _parse_num_slides

        assert _parse_num_slides(topic) == expected

    def test_build_config_uses_topic_count(self):
        from slidev_agent.runtime import _build_config

        config = _build_config({"topic": "Kubernetes入門を15枚で", "job_id": "j"}, None)
        assert config.num_slides == 15

    def test_build_config_payload_wins(self):
        from slidev_agent.runtime import _build_config

        config = _build_config({"topic": "15枚で", "num_slides": 7, "job_id": "j"}, None)
        assert config.num_slides == 7

    def test_build_config_default(self):
        from slidev_agent.runtime import _build_config

        config = _build_config({"topic": "Kubernetes入門", "job_id": "j"}, None)
        assert config.num_slides == 10


class TestTavilyKey:
    def test_env_key_wins(self):
        from slidev_agent.tools import search

        with patch.dict(os.environ, {"TAVILY_API_KEY": "tvly-env"}), patch.object(
            search, "_get_identity_api_key"
        ) as identity:
            search._get_tavily_client()
        identity.assert_not_called()

    def test_falls_back_to_identity_provider(self):
        from bedrock_agentcore.runtime import BedrockAgentCoreContext

        from slidev_agent.tools import search

        search._get_identity_api_key.cache_clear()
        identity = MagicMock()
        identity.get_api_key = AsyncMock(return_value="tvly-identity")
        env = {"TAVILY_API_KEY_PROVIDER": "tavily-api-key"}
        with (
            patch.dict(os.environ, env),
            patch.object(BedrockAgentCoreContext, "get_workload_access_token", return_value="wat"),
            patch("bedrock_agentcore.services.identity.IdentityClient", return_value=identity),
        ):
            os.environ.pop("TAVILY_API_KEY", None)
            client = search._get_tavily_client()
        search._get_identity_api_key.cache_clear()

        identity.get_api_key.assert_awaited_once_with(
            provider_name="tavily-api-key", agent_identity_token="wat"
        )
        assert client.api_key == "tvly-identity"

    def test_identity_provider_without_token_raises(self):
        from bedrock_agentcore.runtime import BedrockAgentCoreContext

        from slidev_agent.tools import search

        search._get_identity_api_key.cache_clear()
        with (
            patch.dict(os.environ, {"TAVILY_API_KEY_PROVIDER": "tavily-api-key"}),
            patch.object(BedrockAgentCoreContext, "get_workload_access_token", return_value=None),
            pytest.raises(ValueError, match="runtimeUserId"),
        ):
            os.environ.pop("TAVILY_API_KEY", None)
            search._get_tavily_client()

    def test_neither_set_raises(self):
        from slidev_agent.tools import search

        with patch.dict(os.environ, {}, clear=True), pytest.raises(ValueError):
            search._get_tavily_client()
