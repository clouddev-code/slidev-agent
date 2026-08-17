# Strands Agents と Google Vertex AI/Gemini サポート調査レポート

調査日: 2026-02-22

## 1. Strands Agents は Google Vertex AI または Gemini モデルをサポートしているか?

### 結論
**はい、Strands Agents は Gemini モデルをサポートしており、Vertex AI モード経由でのアクセスも可能です。**

### 詳細

#### Gemini サポート
Strands Agents は公式に Gemini モデルプロバイダーをサポートしています。

- **インストール方法**: `pip install 'strands-agents[gemini]'`
- **プロバイダークラス名**: `GeminiModel`
- **インポート**: `from strands.models.gemini import GeminiModel` (Python) または `@strands-agents/sdk/gemini` (TypeScript)

#### Vertex AI モードサポート
Gemini モデルは Vertex AI 経由でもアクセス可能です。

- **設定方法**: 環境変数 `GOOGLE_GENAI_USE_VERTEXAI=True` を設定
- **状態**: サポートされているが、既知のバグあり（後述）

#### サポートされているモデルプロバイダー一覧

Strands Agents は以下のモデルプロバイダーをサポートしています:

1. Amazon Bedrock（組み込み）
2. Anthropic (`anthropic` extra)
3. **Gemini** (`gemini` extra) ✓
4. Cohere（組み込み）
5. LiteLLM (`litellm` extra)
6. llama.cpp（組み込み）
7. LlamaAPI (`llamaapi` extra)
8. MistralAI (`mistral` extra)
9. Ollama (`ollama` extra)
10. OpenAI (`openai` extra)
11. SageMaker (`sagemaker` extra)
12. Writer (`writer` extra)

さらに、カスタムモデルプロバイダーの実装もサポートしています。

## 2. "Gemini 3.1 Pro" とは何か?

### 結論
**"Gemini 3.1 Pro" は実在するモデル名です。これは Google の最新の高度な推論モデルで、2026年2月にリリースされました。**

### Gemini 3.1 Pro の詳細

#### リリース情報
- **発表日**: 2026年2月19日頃
- **位置づけ**: Gemini 3 シリーズの次のイテレーション
- **用途**: 複雑なタスクと高度な推論が必要な場面向け

#### 主要な機能

1. **高度な推論能力**
   - ARC-AGI-2 ベンチマークで 77.1% のスコアを達成
   - これは Gemini 3 Pro の**2倍以上の推論性能**

2. **設計目的**
   - 単純な回答では不十分なタスク向け
   - データ統合、複雑なトピックの説明などに対応
   - ソフトウェアエンジニアリングとエージェント機能の向上

3. **新機能**
   - `thinking_level` パラメータに `MEDIUM` が追加
   - コスト、パフォーマンス、速度のトレードオフを最適化

#### 利用可能性

Gemini 3.1 Pro は以下で利用可能です:
- Gemini アプリ（Google AI Pro および Ultra プランユーザー向けに高い制限付き）
- NotebookLM（Pro および Ultra ユーザー専用）
- Gemini API（プレビュー版）
- AI Studio
- Antigravity
- Vertex AI
- Gemini Enterprise
- Gemini CLI
- Android Studio

### モデル命名の明確化

調査の結果、以下のことが明らかになりました:

- **Gemini 2.5 Pro**: 2026年初頭時点で安定版として提供されている推論モデル
- **Gemini 3.1 Pro**: 2026年2月にリリースされた最新の高度な推論モデル（これが調査対象）
- **Gemini 3 Flash**: Gemini アプリの新しいデフォルトモデル（高速版）

つまり、"Gemini 3.1 Pro" は実際の正式名称であり、"Gemini 2.5 Pro" とは別のモデルです。

## 3. Strands Agents で Vertex AI を使用する場合のモデルプロバイダークラス名と設定方法

### プロバイダークラス名
**`GeminiModel`**

### 設定方法

#### 基本設定（Python）

```python
from strands.models.gemini import GeminiModel

# 標準 Gemini API モード
model = GeminiModel(
    model_id="gemini-2.5-flash",
    client_args={
        "api_key": "YOUR_API_KEY"
    },
    params={
        "temperature": 0.7,
        "max_output_tokens": 1000,
        "top_p": 0.9,
        "top_k": 40
    }
)
```

#### Vertex AI モード設定

Vertex AI モードを有効にするには:

```bash
export GOOGLE_GENAI_USE_VERTEXAI=True
```

```python
from strands.models.gemini import GeminiModel

# Vertex AI モードで使用（環境変数 GOOGLE_GENAI_USE_VERTEXAI=True が必要）
model = GeminiModel(
    model_id="gemini-2.5-flash",
    params={
        "temperature": 0.7,
        "max_output_tokens": 1000
    }
)
```

### 設定パラメータ

#### クライアント設定
- `client_args` (Python) / `clientConfig` (TypeScript): Google GenAI クライアントの設定

#### モデル選択
- `model_id` / `modelId`: モデル識別子（例: `"gemini-2.5-flash"`, `"gemini-3.1-pro"`）

#### モデルパラメータ（`params` 辞書）
- `temperature`: ランダム性の制御
- `max_output_tokens` / `maxOutputTokens`: 生成トークンの最大数
- `top_p` / `topP`: Nucleus サンプリング
- `top_k` / `topK`: Top-K サンプリング
- `candidate_count` / `candidateCount`: 候補数
- `stop_sequences` / `stopSequences`: 停止シーケンス

### 既知の問題

#### Vertex AI モードでのバグ（Issue #1039）

**問題**: Vertex AI モードでツールなしのエージェントを作成すると失敗する

**エラー内容**:
```
google.genai.errors.ClientError: 400 INVALID_ARGUMENT
tools[0].tool_type: required one_of 'tool_type' must have one initialized field
```

**原因**:
- ツールが提供されていない場合、SDK は空の `tools` 配列を送信
- Vertex AI バックエンドは厳密な proto バリデーションを実施し、空の配列を拒否
- 標準 Gemini API はより寛容

**ステータス**: オープン（2025年10月16日報告）

**回避策**:
- プルリクエスト #1040 が提案されている
- ツールが存在しない場合、`tools` フィールドを完全に省略する修正

**影響**: Vertex AI モードで6つの統合テストが失敗

## 4. 追加の発見事項

### Strands Agents の特徴

1. **モデルファースト設計**: 基盤モデルをエージェントインテリジェンスの核とする
2. **AWS との統合**: AWS サービスとシームレスに連携（ただしクロスクラウド対応）
3. **オープンソース**: GitHub で公開されている SDK
4. **モデル非依存**: 複数の LLM プロバイダーをサポート

### Gemini Live サポート

Strands Agents は Gemini Live API もサポートしています:
- 双方向 WebSocket 接続を介したリアルタイム会話
- ストリーミングデータ処理
- 専用の extra: `pip install 'strands-agents[bidi-gemini]'`

### 構造化出力

`Agent.structured_output()` を使用すると、Strands SDK は自動的に Pydantic モデルを Gemini の JSON スキーマ形式に変換します。

### Model Context Protocol (MCP) サポート

ファーストクラスの MCP サポートにより、エージェントは数千のツールにアクセス可能です。

## 情報ソース

### Strands Agents と Vertex AI
- [Gemini - Strands Agents](https://strandsagents.com/latest/documentation/docs/user-guide/concepts/model-providers/gemini/)
- [strands-agents · PyPI](https://pypi.org/project/strands-agents/)
- [GitHub - strands-agents/sdk-python](https://github.com/strands-agents/sdk-python)
- [GeminiModel failure when using Vertex AI mode without tools · Issue #1039](https://github.com/strands-agents/sdk-python/issues/1039)
- [Introducing Strands Agents, an Open Source AI Agents SDK | AWS Open Source Blog](https://aws.amazon.com/blogs/opensource/introducing-strands-agents-an-open-source-ai-agents-sdk/)
- [Compare Strands Agents vs. Vertex AI in 2025](https://slashdot.org/software/comparison/Strands-Agents-vs-Vertex-AI/)
- [Google ADK vs AWS Strands: What's Best AI Agent Platform for Enterprise?](https://www.techaheadcorp.com/blog/google-adk-vs-aws-strands-which-ai-agent-platform-wins/)

### Gemini 3.1 Pro
- [Gemini 3.1 Pro: Announcing our latest Gemini AI model](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-1-pro/)
- [Gemini 3.1 Pro - Model Card — Google DeepMind](https://deepmind.google/models/model-cards/gemini-3-1-pro/)
- [Gemini 3.1 Pro — Google DeepMind](https://deepmind.google/models/gemini/pro/)
- [Gemini 3.1 Pro | Generative AI on Vertex AI | Google Cloud Documentation](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-1-pro)
- [Gemini 3.1 Pro on Gemini CLI, Gemini Enterprise, and Vertex AI | Google Cloud Blog](https://cloud.google.com/blog/products/ai-machine-learning/gemini-3-1-pro-on-gemini-cli-gemini-enterprise-and-vertex-ai)
- [Google releases Gemini 3.1 Pro | heise online](https://www.heise.de/en/news/Google-releases-Gemini-3-1-Pro-11183839.html)
- [Google doubles the reasoning power of its core AI model with Gemini 3.1 Pro](https://chromeunboxed.com/google-doubles-the-reasoning-power-of-its-core-ai-model-with-gemini-3-1-pro/)

### Gemini 2.5 Pro とモデルバージョン
- [Models | Gemini API | Google AI for Developers](https://ai.google.dev/gemini-api/docs/models)
- [Gemini 2.5 Pro | Generative AI on Vertex AI | Google Cloud Documentation](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-pro)
- [Gemini 2.5: Updates to our family of thinking models - Google Developers Blog](https://developers.googleblog.com/en/gemini-2-5-thinking-model-updates/)
- [Gemini 2.5 Pro: Access Google's latest preview AI model](https://blog.google/products-and-platforms/products/gemini/gemini-2-5-pro-latest-preview/)

### その他の参考資料
- [Gemini Live - Strands Agents](https://strandsagents.com/latest/documentation/docs/user-guide/concepts/bidirectional-streaming/models/gemini_live/)
- [FEATURE: Support for Gemini Built-in Tools · Issue #1049](https://github.com/strands-agents/sdk-python/issues/1049)
- [Comparing agentic AI frameworks - AWS Prescriptive Guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/agentic-ai-frameworks/comparing-agentic-ai-frameworks.html)

## まとめ

1. **Strands Agents は Gemini と Vertex AI をサポート**: `GeminiModel` クラスを通じて、標準 Gemini API と Vertex AI モードの両方で使用可能

2. **Gemini 3.1 Pro は実在**: 2026年2月にリリースされた Google の最新高度推論モデルで、前世代の2倍以上の推論性能を持つ

3. **設定は比較的シンプル**: 環境変数 `GOOGLE_GENAI_USE_VERTEXAI=True` で Vertex AI モードを有効化可能

4. **既知の問題**: Vertex AI モードでツールなしのエージェントを作成する際にバグがあるが、修正のプルリクエストが提出済み

5. **豊富な機能**: Gemini Live、構造化出力、MCP サポートなど、高度な機能が利用可能
