# Vertex AI Gemini 3.1 Pro 対応 実装結果

## 概要

Slidev AgentにVertex AI Gemini 3.1 Proのサポートを追加しました。環境変数`MODEL_PROVIDER`でBedrock/Vertex AIの切り替えが可能です。

## 変更ファイル一覧

| ファイル | 変更内容 |
|---------|---------|
| `pyproject.toml` | `strands-agents[gemini]`に変更、description更新 |
| `src/slidev_agent/agent.py` | `create_model()`関数追加、`create_slidev_agent()`をリファクタリング |
| `src/slidev_agent/runtime.py` | `create_model()`をインポートして使用、BedrockModel直接インポートを削除 |
| `.env.example` | Vertex AI関連の環境変数テンプレート追加 |
| `uv.lock` | gemini依存パッケージ追加（google-genai, google-auth等） |

## 主な変更点

### `create_model()` 関数（`agent.py`）

```python
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

### 使い方

#### Bedrock（デフォルト）

```bash
# .envに設定不要（デフォルトでBedrock）
MODEL_PROVIDER=bedrock
```

#### Vertex AI Gemini

```bash
MODEL_PROVIDER=vertexai
GEMINI_MODEL_ID=gemini-3.1-pro-preview
GOOGLE_CLOUD_PROJECT=your-gcp-project-id
GOOGLE_CLOUD_LOCATION=us-central1
GOOGLE_GENAI_USE_VERTEXAI=true
```

## 検証結果

- `uv lock` ... 成功（google-genai, google-auth等8パッケージ追加）
- `uv run --extra dev pytest` ... 10テスト全てパス
- 後方互換性 ... `MODEL_PROVIDER`未設定時はデフォルトでBedrock動作
