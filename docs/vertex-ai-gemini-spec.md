# Vertex AI Gemini 3.1 Pro 対応仕様書

## 概要

Slidev AgentのLLMバックエンドとして、Google Cloud Vertex AIのGemini 3.1 Proを選択可能にする。

## 背景

- 現在はAmazon Bedrock経由でClaude Opus 4.6を使用
- Strands Agentsフレームワークは`GeminiModel`プロバイダーを公式サポート済み
- Gemini 3.1 Proは2026年2月19日にリリースされた最新モデルで、高い推論性能を持つ

## 技術調査結果

### Strands Agents の Gemini サポート

| 項目 | 詳細 |
|------|------|
| インストール | `pip install 'strands-agents[gemini]'` |
| プロバイダークラス | `strands.models.gemini.GeminiModel` |
| Vertex AIモード | 環境変数 `GOOGLE_GENAI_USE_VERTEXAI=True` で有効化 |
| モデルID | `gemini-3.1-pro-preview` |

### 既知の問題

- Vertex AIモードでツールなしエージェント作成時にバグあり（[Issue #1039](https://github.com/strands-agents/sdk-python/issues/1039)）
- 本プロジェクトではツール（web_search, web_extract, write_slidev_markdown）を使用するため、影響なしと想定

## 変更方針

### 方針: モデルプロバイダーの切り替え対応

BedrockModelとGeminiModelを環境変数で切り替え可能にする。

### 変更対象ファイル

| ファイル | 変更内容 |
|---------|---------|
| `pyproject.toml` | `strands-agents[gemini]` 依存追加 |
| `src/slidev_agent/agent.py` | モデルプロバイダー切り替えロジック追加 |
| `src/slidev_agent/runtime.py` | 同上 |
| `.env.example` | Vertex AI用の環境変数テンプレート追加 |

### 新規追加する環境変数

| 変数名 | 必須 | デフォルト | 説明 |
|--------|------|-----------|------|
| `MODEL_PROVIDER` | No | `bedrock` | `bedrock` または `vertexai` |
| `GOOGLE_GENAI_USE_VERTEXAI` | vertexai時 | - | `True` に設定 |
| `GOOGLE_CLOUD_PROJECT` | vertexai時 | - | GCPプロジェクトID |
| `GOOGLE_CLOUD_LOCATION` | vertexai時 | `us-central1` | GCPリージョン |
| `GEMINI_MODEL_ID` | No | `gemini-3.1-pro-preview` | Geminiモデル識別子 |

### 実装設計

#### モデル生成関数の追加（`agent.py`）

```python
from strands.models import BedrockModel

def create_model(provider: str | None = None):
    provider = provider or os.getenv("MODEL_PROVIDER", "bedrock")

    if provider == "vertexai":
        from strands.models.gemini import GeminiModel
        model_id = os.getenv("GEMINI_MODEL_ID", "gemini-3.1-pro-preview")
        return GeminiModel(model_id=model_id)
    else:
        model_id = os.getenv("BEDROCK_MODEL_ID", "us.anthropic.claude-opus-4-6-v1")
        region = os.getenv("AWS_REGION", "us-east-1")
        return BedrockModel(model_id=model_id, region_name=region)
```

#### pyproject.toml の依存関係

```toml
dependencies = [
    "strands-agents[gemini]>=0.1.0",  # gemini extra追加
    # ... 既存の依存関係
]
```

> **Note**: `strands-agents[gemini]`はベースの`strands-agents`を含むため、
> 既存の`strands-agents>=0.1.0`を置き換える形で問題なし。

### GCP認証

Vertex AIを使用する場合、以下のいずれかで認証が必要:

1. `gcloud auth application-default login`（ローカル開発）
2. サービスアカウントキー（`GOOGLE_APPLICATION_CREDENTIALS`環境変数）
3. GCE/Cloud Runのデフォルトサービスアカウント

### ブランチ戦略

- ブランチ名: `feature/vertex-ai-gemini`
- ベースブランチ: `main`

## 実装ステップ

1. `main`ブランチから`feature/vertex-ai-gemini`ブランチを作成
2. `pyproject.toml`に`strands-agents[gemini]`依存を追加
3. `agent.py`にモデルプロバイダー切り替えロジックを実装
4. `runtime.py`に同様のロジックを適用
5. `.env.example`にVertex AI用環境変数を追加
6. `uv lock`で依存関係を更新
7. 動作確認

## リスク・懸念事項

- Gemini 3.1 Proはリリース直後のため、Strands Agentsでのモデル対応状況の確認が必要
  - `gemini-3.1-pro-preview`というモデルIDが正しいか、実際の利用時に要確認
- Vertex AI固有のレートリミットやクォータ制限
- ツール呼び出し（Function Calling）の互換性
  - BedrockのClaudeとGeminiではツール呼び出しのフォーマットが異なるが、Strands Agentsが抽象化しているため問題ない想定
