"""Tests for Slidev Agent tools."""

import os
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


class TestWriteSlidevMarkdown:
    """Tests for write_slidev_markdown tool."""

    def test_write_basic_markdown(self):
        """Test writing basic Slidev markdown."""
        from slidev_agent.tools.writer import write_slidev_markdown

        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = os.path.join(tmpdir, "test.md")

            result = write_slidev_markdown(
                slides_content="# Hello World\n\nThis is a test.",
                output_path=output_path,
                theme="seriph",
                title="Test Presentation",
            )

            assert result["success"] is True
            assert Path(output_path).exists()

            content = Path(output_path).read_text()
            assert "theme: seriph" in content
            assert "title: Test Presentation" in content
            assert "# Hello World" in content

    def test_write_creates_directory(self):
        """Test that missing directories are created."""
        from slidev_agent.tools.writer import write_slidev_markdown

        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = os.path.join(tmpdir, "subdir", "nested", "test.md")

            result = write_slidev_markdown(
                slides_content="# Test",
                output_path=output_path,
            )

            assert result["success"] is True
            assert Path(output_path).exists()


class TestWebSearch:
    """Tests for web_search tool."""

    @patch("slidev_agent.tools.search._get_tavily_client")
    def test_web_search_basic(self, mock_get_client):
        """Test basic web search."""
        from slidev_agent.tools.search import web_search

        mock_client = MagicMock()
        mock_client.search.return_value = {
            "query": "test query",
            "answer": "Test answer",
            "results": [
                {
                    "title": "Test Result",
                    "url": "https://example.com",
                    "content": "Test content",
                    "score": 0.9,
                }
            ],
            "response_time": 1.5,
        }
        mock_get_client.return_value = mock_client

        result = web_search(query="test query", max_results=5)

        assert result["query"] == "test query"
        assert result["answer"] == "Test answer"
        assert len(result["results"]) == 1
        assert result["results"][0]["title"] == "Test Result"

    @patch("slidev_agent.tools.search._get_tavily_client")
    def test_web_search_with_time_range(self, mock_get_client):
        """Test web search with time range filter."""
        from slidev_agent.tools.search import web_search

        mock_client = MagicMock()
        mock_client.search.return_value = {
            "query": "test",
            "results": [],
            "response_time": 1.0,
        }
        mock_get_client.return_value = mock_client

        web_search(query="test", time_range="week")

        mock_client.search.assert_called_once()
        call_kwargs = mock_client.search.call_args[1]
        assert call_kwargs["time_range"] == "week"


class TestWebExtract:
    """Tests for web_extract tool."""

    @patch("slidev_agent.tools.search._get_tavily_client")
    def test_web_extract_success(self, mock_get_client):
        """Test successful content extraction."""
        from slidev_agent.tools.search import web_extract

        mock_client = MagicMock()
        mock_client.extract.return_value = {
            "results": [
                {
                    "url": "https://example.com",
                    "raw_content": "Extracted content here",
                }
            ]
        }
        mock_get_client.return_value = mock_client

        result = web_extract(url="https://example.com")

        assert result["success"] is True
        assert result["content"] == "Extracted content here"

    @patch("slidev_agent.tools.search._get_tavily_client")
    def test_web_extract_no_results(self, mock_get_client):
        """Test extraction with no results."""
        from slidev_agent.tools.search import web_extract

        mock_client = MagicMock()
        mock_client.extract.return_value = {"results": []}
        mock_get_client.return_value = mock_client

        result = web_extract(url="https://example.com")

        assert result["success"] is False
        assert "error" in result


class TestAgentConfig:
    """Tests for agent configuration."""

    def test_slidev_agent_config_defaults(self):
        """Test SlidevAgentConfig default values."""
        from slidev_agent.agent import SlidevAgentConfig

        config = SlidevAgentConfig(topic="Test Topic")

        assert config.topic == "Test Topic"
        assert config.num_slides == 10
        assert config.style == "technical"
        assert config.theme == "default"
        assert config.language == "ja"
        assert config.output_path == "./output/slides.md"

    def test_slidev_agent_config_custom(self):
        """Test SlidevAgentConfig with custom values."""
        from slidev_agent.agent import SlidevAgentConfig

        config = SlidevAgentConfig(
            topic="Custom Topic",
            num_slides=15,
            style="business",
            theme="seriph",
            language="en",
            output_path="./custom/path.md",
        )

        assert config.topic == "Custom Topic"
        assert config.num_slides == 15
        assert config.style == "business"
        assert config.theme == "seriph"
        assert config.language == "en"
        assert config.output_path == "./custom/path.md"


class TestBuildUserPrompt:
    """Tests for build_user_prompt function."""

    def test_build_user_prompt_japanese(self):
        """Test prompt generation for Japanese."""
        from slidev_agent.agent import SlidevAgentConfig, build_user_prompt

        config = SlidevAgentConfig(
            topic="テストトピック",
            num_slides=10,
            style="technical",
            language="ja",
        )

        prompt = build_user_prompt(config)

        assert "テストトピック" in prompt
        assert "10枚" in prompt
        assert "日本語" in prompt

    def test_build_user_prompt_english(self):
        """Test prompt generation for English."""
        from slidev_agent.agent import SlidevAgentConfig, build_user_prompt

        config = SlidevAgentConfig(
            topic="Test Topic",
            language="en",
        )

        prompt = build_user_prompt(config)

        assert "Test Topic" in prompt
        assert "English" in prompt
