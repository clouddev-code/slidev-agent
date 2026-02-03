"""Slidev Agent using Strands Agents framework."""

import os
from dataclasses import dataclass
from typing import Literal

from strands import Agent
from strands.models import BedrockModel

from .prompts import SYSTEM_PROMPT
from .tools import web_extract, web_search, write_slidev_markdown


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
) -> Agent:
    """
    Create a Slidev Agent instance.

    Args:
        model_id: Bedrock model ID to use. Defaults to env BEDROCK_MODEL_ID or Claude Sonnet.
        region: AWS region for Bedrock. Defaults to env AWS_REGION or us-east-1.

    Returns:
        Configured Strands Agent for Slidev generation.
    """
    model_id = model_id or os.getenv(
        "BEDROCK_MODEL_ID", "us.anthropic.claude-sonnet-4-20250514-v1:0"
    )
    region = region or os.getenv("AWS_REGION", "us-east-1")

    model = BedrockModel(
        model_id=model_id,
        region_name=region,
    )

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
