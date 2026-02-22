"""Slidev Agent using Strands Agents framework."""

import os
from dataclasses import dataclass
from typing import Literal

from strands import Agent
from strands.models import BedrockModel

from .prompts import SYSTEM_PROMPT
from .tools import web_extract, web_search, write_slidev_markdown


def create_model(provider: str | None = None):
    """
    Create a model instance based on the provider.

    Args:
        provider: Model provider ('bedrock' or 'vertexai').
                  Defaults to env MODEL_PROVIDER or 'bedrock'.

    Returns:
        Configured model instance.
    """
    provider = provider or os.getenv("MODEL_PROVIDER", "bedrock")

    if provider == "vertexai":
        from strands.models.gemini import GeminiModel

        model_id = os.getenv("GEMINI_MODEL_ID", "gemini-3.1-pro")
        return GeminiModel(model_id=model_id)
    else:
        model_id = os.getenv("BEDROCK_MODEL_ID", "us.anthropic.claude-opus-4-6-v1")
        region = os.getenv("AWS_REGION", "us-east-1")
        return BedrockModel(model_id=model_id, region_name=region)


@dataclass
class SlidevAgentConfig:
    """Configuration for Slidev Agent."""

    topic: str
    num_slides: int = 10
    style: Literal["technical", "business", "educational", "pitch"] = "technical"
    theme: str = "default"
    language: str = "ja"
    output_path: str = "./output/slides.md"


def create_slidev_agent(
    model_id: str | None = None,
    region: str | None = None,
    provider: str | None = None,
) -> Agent:
    """
    Create a Slidev Agent instance.

    Args:
        model_id: Bedrock model ID (kept for backward compatibility).
        region: AWS region (kept for backward compatibility).
        provider: Model provider ('bedrock' or 'vertexai').

    Returns:
        Configured Strands Agent for Slidev generation.
    """
    model = create_model(provider)

    agent = Agent(
        model=model,
        system_prompt=SYSTEM_PROMPT,
        tools=[web_search, web_extract, write_slidev_markdown],
    )

    return agent


def build_user_prompt(config: SlidevAgentConfig) -> str:
    """
    Build the user prompt based on configuration.

    Args:
        config: Slidev agent configuration.

    Returns:
        Formatted user prompt string.
    """
    style_descriptions = {
        "technical": "技術的で詳細な内容、コード例を含む",
        "business": "ビジネス向け、ROIや価値を強調",
        "educational": "教育的で初心者にも分かりやすい説明",
        "pitch": "説得力のある、問題解決型のプレゼンテーション",
    }

    language_instructions = {
        "ja": "日本語で作成してください。",
        "en": "Please create in English.",
    }

    prompt = f"""以下の条件でSlidevプレゼンテーションを作成してください。

## トピック
{config.topic}

## 要件
- スライド数: 約{config.num_slides}枚
- スタイル: {config.style} ({style_descriptions.get(config.style, config.style)})
- テーマ: {config.theme}
- 出力先: {config.output_path}
- 言語: {language_instructions.get(config.language, f"{config.language}で作成")}

## 手順
1. まず、トピックについてweb_searchツールで3-5回検索して情報を収集してください
2. 必要に応じてweb_extractで詳細情報を取得してください
3. 収集した情報を基にスライドを構成してください
4. write_slidev_markdownツールで最終的なMarkdownファイルを出力してください

必ず最後にwrite_slidev_markdownツールを使用してファイルを保存してください。
"""

    return prompt


def run_slidev_agent(config: SlidevAgentConfig) -> str:
    """
    Run the Slidev Agent with the given configuration.

    Args:
        config: Configuration for the presentation generation.

    Returns:
        Agent response text.
    """
    agent = create_slidev_agent()
    user_prompt = build_user_prompt(config)

    response = agent(user_prompt)

    return str(response)
