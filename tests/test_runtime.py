"""Tests for the runtime payload handling and Tavily key resolution."""

import os
from unittest.mock import MagicMock, patch

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
            search, "_get_secret_api_key"
        ) as secret:
            search._get_tavily_client()
        secret.assert_not_called()

    def test_falls_back_to_secrets_manager(self):
        from slidev_agent.tools import search

        search._get_secret_api_key.cache_clear()
        sm = MagicMock()
        sm.get_secret_value.return_value = {"SecretString": "tvly-secret\n"}
        env = {"TAVILY_SECRET_NAME": "slidev-agent/TAVILY_API_KEY"}
        with patch.dict(os.environ, env), patch("boto3.client", return_value=sm):
            os.environ.pop("TAVILY_API_KEY", None)
            client = search._get_tavily_client()
        search._get_secret_api_key.cache_clear()

        sm.get_secret_value.assert_called_once_with(SecretId="slidev-agent/TAVILY_API_KEY")
        assert client.api_key == "tvly-secret"

    def test_neither_set_raises(self):
        from slidev_agent.tools import search

        with patch.dict(os.environ, {}, clear=True), pytest.raises(ValueError):
            search._get_tavily_client()
