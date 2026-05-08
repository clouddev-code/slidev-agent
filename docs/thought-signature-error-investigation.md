# Vertex AI Gemini `thought_signature` エラー調査レポート

調査日: 2026-02-22

## エラー概要

```
Unable to submit request because function call `default_api:web_extract` in the 2. content block
is missing a `thought_signature`.
Learn more: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/thought-signatures
```

---

## 1. thought_signature とは何か

### 概要

`thought_signature` は、Gemini の Thinking モデル（Gemini 3.x / 2.5 Pro 等）が内部推論プロセスを暗号化して表現したものである。マルチターン会話、特に **Function Calling（ツール呼び出し）ワークフロー** において、モデルの推論状態を保持するための仕組みとなる。

### 動作原理

1. モデルが外部ツール（Function Call）を呼び出す際、内部推論プロセスを一時停止する
2. `thought_signature` はこの推論状態の「セーブデータ」として機能する
3. ツール実行結果を返す次のリクエストで、`thought_signature` を正確に返却することで、モデルは中断した推論を再開できる
4. `thought_signature` がないと、モデルはツール実行中の推論コンテキストを「忘れて」しまう

### 技術的詳細

- `thought_signature` はバイナリデータ（bytes）として返される
- API レスポンスの `functionCall` パートに含まれる
- 次のリクエストの会話履歴に、受信したものをそのまま（改変せずに）含める必要がある

---

## 2. エラーが発生する条件

### Gemini 3.x モデル（厳密に強制）

Gemini 3 Pro / 3 Flash / 3.1 Pro では、以下の条件で **400 エラー** が発生する：

| 条件 | エラー発生 |
|------|-----------|
| `functionCall` パートを含むレスポンスの `thought_signature` を次のリクエストで省略 | **必ず発生** |
| 逐次的な複数ツール呼び出しで、途中の `thought_signature` を省略 | **必ず発生** |
| `thought_signature` を改変して返却 | **必ず発生** |

### Gemini 2.5 Pro / Flash

- `thought_signature` の返却は推奨されるが、省略しても 400 エラーにはならない
- パフォーマンスへの影響はある

### 並列ツール呼び出しの特殊ルール

- 並列 Function Call の場合、`thought_signature` は **最初の functionCall パートのみ** に付与される
- 2つ目以降の functionCall パートには signature がない（これは正常動作）

---

## 3. strands-agents SDK での問題の原因と解決方法

### 根本原因

現在インストールされている strands-agents SDK **v1.24.0** には、Gemini 3.x の `thought_signature` を正しく処理する実装が含まれていない。

具体的には、`strands/models/gemini.py` の `_format_request_content_part` メソッドにおいて：

1. **レスポンス受信時**: ストリームから `thought_signature` を `reasoningContent` として受け取る処理は存在する（366-377行目）
2. **リクエスト送信時**: `toolUse` ブロックを `genai.types.FunctionCall` に変換する際に、`thought_signature` が **付与されていない**（204-213行目）

```python
# v1.24.0 の問題箇所 - thought_signature が欠落
if "toolUse" in content:
    tool_use_id_to_name[content["toolUse"]["toolUseId"]] = content["toolUse"]["name"]
    return genai.types.Part(
        function_call=genai.types.FunctionCall(
            args=content["toolUse"]["input"],
            id=content["toolUse"]["toolUseId"],
            name=content["toolUse"]["name"],
        ),
        # thought_signature が付与されていない!
    )
```

### 修正済みバージョン

この問題は以下の PR で修正された：

- **PR**: [#1703 - fix: propagate reasoningSignature on Gemini tool use](https://github.com/strands-agents/sdk-python/pull/1703)
- **マージ日**: 2026-02-16
- **修正内容**:
  - `ToolUse` TypedDict に `reasoningSignature` フィールドを追加
  - ストリーミングハンドラで reasoning signature を content block start/stop を通じて伝搬
  - `thought_signature` の base64 エンコード/デコードを修正（UTF-8 直接変換からの変更）
  - Gemini の `function_call` パートに reasoning signature をスレッド

### 解決方法 A: SDK のアップグレード（推奨）

```bash
# v1.27.0 以降にアップグレード
uv pip install "strands-agents[gemini]>=1.27.0"
```

`pyproject.toml` の修正：

```toml
dependencies = [
    "strands-agents[gemini]>=1.27.0",  # thought_signature 修正を含む
    # ...
]
```

### 解決方法 B: Thinking を無効にする（暫定回避策）

SDK をアップグレードできない場合、`GenerateContentConfig` で Thinking を無効にする。

```python
from strands.models.gemini import GeminiModel

model = GeminiModel(
    model_id="gemini-3.1-pro-preview",
    params={
        "thinking_config": {
            "thinking_budget": 0,  # Thinking を無効化
        }
    }
)
```

ただし、Gemini 3.x モデルでは Thinking がデフォルトで有効であり、無効にするとモデルの推論性能が大幅に低下するため、**解決方法 A を強く推奨** する。

### 解決方法 C: カスタム GeminiModel でパッチ適用（緊急回避策）

SDK アップグレードが困難で、かつ Thinking を維持したい場合、`_format_request_content_part` をオーバーライドする。

```python
from strands.models.gemini import GeminiModel
from google import genai

class PatchedGeminiModel(GeminiModel):
    def _format_request_content_part(self, content, tool_use_id_to_name):
        if "toolUse" in content:
            tool_use_id_to_name[content["toolUse"]["toolUseId"]] = content["toolUse"]["name"]

            # thought_signature を取得（存在する場合）
            thought_sig = content["toolUse"].get("reasoningSignature")

            return genai.types.Part(
                function_call=genai.types.FunctionCall(
                    args=content["toolUse"]["input"],
                    id=content["toolUse"]["toolUseId"],
                    name=content["toolUse"]["name"],
                ),
                thought_signature=thought_sig.encode("utf-8") if thought_sig else None,
            )

        return super()._format_request_content_part(content, tool_use_id_to_name)
```

**注意**: この方法だけでは不十分な可能性が高い。strands-agents の内部型（`ToolUse` TypedDict）や `streaming.py` も `reasoningSignature` フィールドをサポートする必要がある。そのため、**解決方法 A（SDK アップグレード）が唯一の確実な方法** となる。

### 解決方法 D: skip_thought_signature_validator（最終手段）

Google のドキュメントによると、`thought_signature` フィールドに特殊な値 `"skip_thought_signature_validator"` を設定することでバリデーションをスキップできる。ただし、**モデルのパフォーマンスが大幅に低下する** ため、最終手段としてのみ使用すべきである。

---

## 4. 本プロジェクトへの影響と対応

### 現在の状態

| 項目 | 値 |
|------|-----|
| 使用モデル | `gemini-3.1-pro-preview` |
| インストール済み SDK バージョン | `1.24.0` |
| 修正を含む最小バージョン | `1.27.0` |
| 最新リリース | `1.27.0` (2026-02-19) |

### 推奨アクション

1. **即座に `strands-agents[gemini]` を v1.27.0 にアップグレードする**
2. `pyproject.toml` のバージョン制約を `>=1.27.0` に更新する
3. アップグレード後、Gemini 3.1 Pro でツール呼び出しが正常に動作するか検証する

---

## 参考資料

### 公式ドキュメント
- [Thought signatures | Vertex AI ドキュメント](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/thought-signatures)
- [Thought Signatures | Gemini API](https://ai.google.dev/gemini-api/docs/thought-signatures)
- [Gemini 3 Developer Guide](https://ai.google.dev/gemini-api/docs/gemini-3)

### strands-agents SDK 関連
- [Issue #1199 - BUG: INVALID_ARGUMENT using gemini-3-pro-preview](https://github.com/strands-agents/sdk-python/issues/1199)
- [PR #1703 - fix: propagate reasoningSignature on Gemini tool use](https://github.com/strands-agents/sdk-python/pull/1703)

### コミュニティ報告（他のフレームワークでの同様の問題）
- [langchain-google Issue #1364](https://github.com/langchain-ai/langchain-google/issues/1364)
- [n8n Community - Gemini 3.0 thought_signature issue](https://community.n8n.io/t/issue-with-gemini-3-0-gemini-3-pro-preview-tools-function-call-is-missing-a-thought-signature/223824)
- [openai-agents-python Issue #2137](https://github.com/openai/openai-agents-python/issues/2137)
