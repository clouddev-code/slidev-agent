"""Tests for Slidev Agent tools."""

import os
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

from slidev_agent.tools.validator import (
    _parse_slides,
    validate_slides_fit,
)


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
        assert config.theme == "penguin"
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


SAMPLE_DOC_HEADER = """---
theme: penguin
title: Test
mdc: true
---

"""


class TestValidateSlidesFit:
    """Tests for validate_slides_fit tool."""

    def test_parses_slides_with_and_without_frontmatter(self):
        markdown = SAMPLE_DOC_HEADER + (
            "---\n"
            "layout: intro\n"
            "---\n\n"
            "# Title\n\n"
            "Subtitle\n\n"
            "---\n\n"
            "# Plain slide\n\n"
            "- one\n"
            "- two\n"
        )
        slides = _parse_slides(markdown)
        assert len(slides) == 2
        assert slides[0].layout == "intro"
        assert slides[1].layout == "default"
        assert "Title" in slides[0].body
        assert "Plain slide" in slides[1].body

    def test_short_slide_fits(self):
        markdown = SAMPLE_DOC_HEADER + (
            "---\n\n"
            "# Short slide\n\n"
            "- bullet 1\n"
            "- bullet 2\n"
            "- bullet 3\n"
        )
        result = validate_slides_fit(slides_content=markdown)
        assert result["success"] is True
        assert result["all_fit"] is True
        assert result["overflow_count"] == 0
        assert result["total_slides"] == 1

    def test_long_slide_overflows(self):
        body = "\n".join([f"- bullet line number {i} with extra context text" for i in range(40)])
        markdown = SAMPLE_DOC_HEADER + f"---\n\n# Big slide\n\n{body}\n"
        result = validate_slides_fit(slides_content=markdown)
        assert result["success"] is True
        assert result["all_fit"] is False
        assert 1 in result["overflow_slide_indices"]
        slide = result["slides"][0]
        assert slide["overflows"] is True
        assert slide["estimated_rows"] > slide["max_rows"]
        assert slide["suggestions"], "expected suggestions for overflowing slide"

    def test_section_layout_has_tighter_budget(self):
        body = "\n".join(f"line {i}" for i in range(12))
        markdown = SAMPLE_DOC_HEADER + (
            "---\nlayout: new-section\n---\n\n"
            f"# Big section\n\n{body}\n"
        )
        result = validate_slides_fit(slides_content=markdown)
        assert result["overflow_count"] == 1
        assert result["slides"][0]["layout"] == "new-section"

    def test_two_cols_evaluates_columns_independently(self):
        # Each column ~5 lines, well within budget
        markdown = SAMPLE_DOC_HEADER + (
            "---\nlayout: two-cols\n---\n\n"
            "# Two cols\n\n"
            "- a\n- b\n- c\n\n"
            "::right::\n\n"
            "- x\n- y\n- z\n"
        )
        result = validate_slides_fit(slides_content=markdown)
        assert result["all_fit"] is True
        assert result["slides"][0]["layout"] == "two-cols"

    def test_presenter_notes_excluded(self):
        notes = "\n".join(f"note line {i}" for i in range(80))
        markdown = SAMPLE_DOC_HEADER + (
            "---\n\n# Slide\n\nShort body\n\n"
            f"<!--\n{notes}\n-->\n"
        )
        result = validate_slides_fit(slides_content=markdown)
        assert result["all_fit"] is True

    def test_validate_from_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "slides.md"
            path.write_text(
                SAMPLE_DOC_HEADER + "---\n\n# Hello\n\n- one\n",
                encoding="utf-8",
            )
            result = validate_slides_fit(output_path=str(path))
            assert result["success"] is True
            assert result["total_slides"] == 1

    def test_missing_file_returns_failure(self):
        result = validate_slides_fit(output_path="/nonexistent/path/slides.md")
        assert result["success"] is False
        assert result["all_fit"] is False
        assert "not found" in result["message"].lower()

    def test_long_code_block_flagged(self):
        code = "\n".join(f"line_{i} = {i}" for i in range(40))
        markdown = SAMPLE_DOC_HEADER + (
            "---\n\n# Code heavy\n\n```python\n" + code + "\n```\n"
        )
        result = validate_slides_fit(slides_content=markdown)
        assert result["all_fit"] is False
        reasons = result["slides"][0]["reasons"]
        assert any("コードブロック" in r for r in reasons)


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
