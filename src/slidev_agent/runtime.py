"""AgentCore Runtime handler for Slidev Agent."""

import json
import os
from typing import Any

from strands import Agent

from .agent import create_model
from .prompts import SYSTEM_PROMPT
from .tools import web_extract, web_search, write_slidev_markdown


def create_agent() -> Agent:
    """Create the Slidev agent for AgentCore Runtime."""
    model = create_model()

    agent = Agent(
        model=model,
        system_prompt=SYSTEM_PROMPT,
        tools=[web_search, web_extract, write_slidev_markdown],
    )

    return agent


def build_prompt_from_payload(payload: dict[str, Any]) -> str:
    """
    Build user prompt from AgentCore Runtime payload.

    Args:
        payload: Request payload containing:
            - topic: Presentation topic (required)
            - num_slides: Number of slides (default: 10)
            - style: Presentation style (default: technical)
            - theme: Slidev theme (default: default)
            - language: Output language (default: ja)

    Returns:
        Formatted prompt string.
    """
    topic = payload.get("topic", "")
    if not topic:
        raise ValueError("'topic' is required in payload")

    num_slides = payload.get("num_slides", 10)
    style = payload.get("style", "technical")
    theme = payload.get("theme", "penguin")
    language = payload.get("language", "ja")
    output_path = payload.get("output_path", "./output/slides.md")

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
{topic}

## 要件
- スライド数: 約{num_slides}枚
- スタイル: {style} ({style_descriptions.get(style, style)})
- テーマ: {theme}
- 出力先: {output_path}
- 言語: {language_instructions.get(language, f"{language}で作成")}

## 手順
1. まず、トピックについてweb_searchツールで3-5回検索して情報を収集してください
2. 必要に応じてweb_extractで詳細情報を取得してください
3. 収集した情報を基にスライドを構成してください
4. write_slidev_markdownツールで最終的なMarkdownファイルを出力してください

必ず最後にwrite_slidev_markdownツールを使用してファイルを保存してください。
"""

    return prompt


# Global agent instance for AgentCore Runtime
_agent: Agent | None = None


def get_agent() -> Agent:
    """Get or create the global agent instance."""
    global _agent
    if _agent is None:
        _agent = create_agent()
    return _agent


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """
    AgentCore Runtime handler function.

    This is the entry point for AgentCore Runtime invocations.

    Args:
        event: Request event containing the payload.
        context: Runtime context (unused but required by interface).

    Returns:
        Response dictionary with result or error.
    """
    try:
        # Extract payload from event
        payload = event.get("payload", event)
        if isinstance(payload, str):
            payload = json.loads(payload)

        # Build prompt and run agent
        prompt = build_prompt_from_payload(payload)
        agent = get_agent()
        response = agent(prompt)

        return {
            "statusCode": 200,
            "body": {
                "result": str(response),
                "topic": payload.get("topic", ""),
                "output_path": payload.get("output_path", "./output/slides.md"),
            },
        }

    except ValueError as e:
        return {
            "statusCode": 400,
            "body": {
                "error": str(e),
                "message": "Invalid request payload",
            },
        }
    except Exception as e:
        error_msg = str(e)
        # Provide actionable guidance for MaxTokensReachedException
        if "max_tokens" in error_msg.lower() or "MaxTokensReached" in error_msg:
            return {
                "statusCode": 500,
                "body": {
                    "error": error_msg,
                    "message": "Agent reached max_tokens limit. Try reducing num_slides or simplifying the topic.",
                },
            }
        return {
            "statusCode": 500,
            "body": {
                "error": error_msg,
                "message": "Internal server error",
            },
        }


# AgentCore Runtime entry point
def agentcore_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Alias for handler - AgentCore Runtime entry point."""
    return handler(event, context)
