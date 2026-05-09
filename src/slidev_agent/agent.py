"""Slidev Agent — both single-agent (CLI) and multi-agent Graph (AgentCore Runtime).

The multi-agent build (Agent Teams) splits responsibilities across four
specialized roles connected as a directed graph with a feedback loop:

    planner → researcher → writer → validator
                                       │
                                       └─[needs_revision]→ writer

  - planner    : 構成案 (slide outline) を作る。tool 不要。
  - researcher : web_search / web_extract で情報収集。
  - writer     : write_slidev_markdown で .md (or S3) を書き出す。
  - validator  : validate_slides_fit で枠内検証。`approved` か
                 `revision needed` を本文に明記する。

The graph supports the legacy single-agent shape too via
`create_slidev_agent` / `run_slidev_agent` for the CLI.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Literal

from strands import Agent
from strands.models import BedrockModel
from strands.multiagent import GraphBuilder

from .prompts import SYSTEM_PROMPT
from .tools import (
    validate_slides_fit,
    web_extract,
    web_search,
    write_slidev_markdown,
)


# ---------------------------------------------------------------------------
# Model factory
# ---------------------------------------------------------------------------


def create_model(provider: str | None = None):
    """Create a model instance based on the provider.

    Args:
        provider: Model provider ('bedrock' or 'vertexai').
                  Defaults to env MODEL_PROVIDER or 'bedrock'.
    """
    provider = provider or os.getenv("MODEL_PROVIDER", "bedrock")

    if provider == "vertexai":
        from strands.models.gemini import GeminiModel

        model_id = os.getenv("GEMINI_MODEL_ID", "gemini-3.1-pro-preview")
        return GeminiModel(model_id=model_id, max_tokens=16384)

    model_id = os.getenv("BEDROCK_MODEL_ID", "us.anthropic.claude-opus-4-6-v1")
    region = os.getenv("AWS_REGION", "us-east-1")
    return BedrockModel(model_id=model_id, region_name=region, max_tokens=16384)


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------


@dataclass
class SlidevAgentConfig:
    """Configuration for Slidev Agent."""

    topic: str
    num_slides: int = 10
    style: Literal["technical", "business", "educational", "pitch"] = "technical"
    theme: str = "penguin"
    language: str = "ja"
    output_path: str = "./output/slides.md"


# ---------------------------------------------------------------------------
# Legacy single-agent (CLI fallback)
# ---------------------------------------------------------------------------


def create_slidev_agent(provider: str | None = None) -> Agent:
    """Create a single-agent Slidev generator. Used by the CLI."""
    model = create_model(provider)
    return Agent(
        model=model,
        system_prompt=SYSTEM_PROMPT,
        tools=[web_search, web_extract, write_slidev_markdown, validate_slides_fit],
    )


# ---------------------------------------------------------------------------
# Prompt builders (shared)
# ---------------------------------------------------------------------------


_STYLE_DESC = {
    "technical": "技術的で詳細な内容、コード例を含む",
    "business": "ビジネス向け、ROIや価値を強調",
    "educational": "教育的で初心者にも分かりやすい説明",
    "pitch": "説得力のある、問題解決型のプレゼンテーション",
}

_LANG_INSTR = {
    "ja": "日本語で作成してください。",
    "en": "Please create in English.",
}


def build_user_prompt(config: SlidevAgentConfig) -> str:
    """Build the user prompt for the legacy single-agent workflow."""
    return (
        f"以下の条件でSlidevプレゼンテーションを作成してください。\n\n"
        f"## トピック\n{config.topic}\n\n"
        f"## 要件\n"
        f"- スライド数: 約{config.num_slides}枚\n"
        f"- スタイル: {config.style} ({_STYLE_DESC.get(config.style, config.style)})\n"
        f"- テーマ: {config.theme}\n"
        f"- 出力先: {config.output_path}\n"
        f"- 言語: {_LANG_INSTR.get(config.language, f'{config.language}で作成')}\n\n"
        "## 手順\n"
        "1. web_search ツールで 3-5 回検索して情報を収集\n"
        "2. 必要に応じて web_extract で詳細取得\n"
        "3. 収集情報をもとに構成\n"
        "4. write_slidev_markdown で保存\n"
        "5. validate_slides_fit で枠内検証\n"
        "6. overflow_count > 0 の場合は該当スライドを再生成 (最大3回)\n"
        "7. all_fit が true で完了\n"
    )


def run_slidev_agent(config: SlidevAgentConfig) -> str:
    """Run the legacy single-agent flow."""
    agent = create_slidev_agent()
    return str(agent(build_user_prompt(config)))


# ---------------------------------------------------------------------------
# Multi-agent (Agent Teams via Strands Graph)
# ---------------------------------------------------------------------------


_PLANNER_SYSTEM = """You are a presentation planning specialist.

あなたは Slidev プレゼンテーションの構成 (outline) を設計します。

入力として渡されるトピック / 要件 / スタイルから、以下を含む outline を Markdown で出力してください:
- 各スライドのタイトル (#1〜#N)
- 各スライドで扱う論点 (1-3 行)
- 想定する layout ヒント (default / two-cols / center / section など)
- スライドが overflow しないよう 1 枚あたりの情報量を意識する

ツールは使用せず、テキストのみ返してください。下流の researcher/writer
が参照します。
"""


_RESEARCHER_SYSTEM = """You are a research specialist for slide content.

planner から渡された outline を読み、各セクションで必要な事実・コード例・
URL・統計値を web_search / web_extract を使って収集してください。
最終出力は writer が参照する「研究ノート」(Markdown) です。

要点:
- 各スライドに対応する根拠・数字・コード断片
- 出典 URL (writer がスライド末尾に references 行として書ける形式)
- 不確かな情報は明記し、推測はしない
"""


_WRITER_SYSTEM = """You are a Slidev markdown writer specialist.

planner の outline と researcher のノートを読み、Slidev 形式の Markdown を
生成して `write_slidev_markdown` ツールで保存してください。

絶対要件:
- ツール呼び出し時の `output_path` は invocation 引数で渡された
  `output_path` を必ず使用すること (S3 URI のまま)。
- ツール呼び出し時の `theme` も `theme` 引数を尊重すること。
- 各スライドは 16:9 default canvas に収まる情報量に絞る。
- フロントマターヘッダ (theme: ... の `---` ブロック) は書かない
  (ツールが自動付与する)。
- 1 枚目はカバー、最後は references。
- レビュー (validator) で `revision needed` と返ってきた場合は、
  該当スライドだけを修正して再度 write_slidev_markdown で上書き。

返答の最後に「saved to <path>」を明記してください。
"""


_VALIDATOR_SYSTEM = """You are a layout fit validator.

writer が保存したスライドに対して `validate_slides_fit` ツールを呼び、
overflow が無いかを判定してください。

出力ルール:
- overflow_count == 0 の場合 → 本文に必ず `approved` という単語を含める
- overflow_count > 0 の場合 → 本文に必ず `revision needed` を含め、
  問題スライド (#index) と修正方針を簡潔に列挙する

writer はあなたの指摘を読んで該当スライドだけを書き直します。
"""


def _planner_user_prompt(config: SlidevAgentConfig) -> str:
    return (
        "以下の Slidev プレゼンテーションの outline (構成案) を Markdown で作成してください。\n\n"
        f"- トピック: {config.topic}\n"
        f"- スライド数: 約 {config.num_slides} 枚\n"
        f"- スタイル: {config.style} ({_STYLE_DESC.get(config.style, config.style)})\n"
        f"- テーマ: {config.theme}\n"
        f"- 言語: {_LANG_INSTR.get(config.language, config.language)}\n\n"
        "各スライドは番号 (#1〜) と推奨 layout、3行以内の要点を書いてください。"
    )


def _writer_invocation_state(config: SlidevAgentConfig) -> dict[str, Any]:
    """Common invocation state passed to all graph nodes."""
    return {
        "output_path": config.output_path,
        "theme": config.theme,
        "language": config.language,
        "num_slides": config.num_slides,
        "style": config.style,
        "topic": config.topic,
    }


def _writer_seed_message(config: SlidevAgentConfig) -> str:
    """Reminder appended to writer/validator runs so the LLM has hard params."""
    return (
        "## 必須パラメータ (上書き禁止)\n"
        f"- output_path: `{config.output_path}`\n"
        f"- theme: `{config.theme}`\n"
        f"- title: `{config.topic}`\n"
        f"- language: {config.language}\n"
        f"- num_slides: 約 {config.num_slides}\n"
    )


def _needs_revision(state) -> bool:
    """Edge condition: validator says revision needed."""
    result = state.results.get("validator")
    if not result:
        return False
    return "revision needed" in str(result.result).lower()


def _is_approved(state) -> bool:
    """Edge condition: validator approved."""
    result = state.results.get("validator")
    if not result:
        return False
    return "approved" in str(result.result).lower()


def create_slidev_graph(config: SlidevAgentConfig, provider: str | None = None):
    """Create a multi-agent Slidev graph (planner→researcher→writer→validator).

    The graph supports a feedback loop where validator can send the work back
    to writer for revision, with a hard cap of 3 revision rounds.
    """
    model = create_model(provider)

    planner = Agent(
        name="planner",
        model=model,
        system_prompt=_PLANNER_SYSTEM,
    )

    researcher = Agent(
        name="researcher",
        model=model,
        system_prompt=_RESEARCHER_SYSTEM,
        tools=[web_search, web_extract],
    )

    seed = _writer_seed_message(config)

    writer = Agent(
        name="writer",
        model=model,
        system_prompt=_WRITER_SYSTEM + "\n\n" + seed,
        tools=[write_slidev_markdown],
    )

    validator = Agent(
        name="validator",
        model=model,
        system_prompt=_VALIDATOR_SYSTEM + "\n\n" + seed,
        tools=[validate_slides_fit],
    )

    builder = GraphBuilder()
    builder.add_node(planner, "planner")
    builder.add_node(researcher, "researcher")
    builder.add_node(writer, "writer")
    builder.add_node(validator, "validator")

    builder.add_edge("planner", "researcher")
    builder.add_edge("researcher", "writer")
    builder.add_edge("writer", "validator")
    # Feedback loop: validator → writer when revision needed
    builder.add_edge("validator", "writer", condition=_needs_revision)

    builder.set_entry_point("planner")
    # Caps for the feedback loop
    builder.set_max_node_executions(12)
    builder.set_execution_timeout(900)
    builder.reset_on_revisit(True)

    return builder.build()


def build_graph_seed_prompt(config: SlidevAgentConfig) -> str:
    """The text prompt fed to the entry node (planner)."""
    return _planner_user_prompt(config)
