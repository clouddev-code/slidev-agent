# Vertex AI Gemini thought_signature エラー修正

## エラー概要

Gemini 3.1 Pro Preview モデル使用時に以下のエラーが発生:

```
google.genai.errors.ClientError: 400 Bad Request
"Unable to submit request because function call `default_api:web_extract`
in the 2. content block is missing a `thought_signature`"
```

## 原因

- Gemini 3.x モデル（3 Pro / 3 Flash / 3.1 Pro）では、Thinking モデルがFunction Calling（ツール呼び出し）を行う際に `thought_signature` を次のリクエストにそのまま返すことが**必須**
- `thought_signature` はモデルの内部推論プロセスの状態を暗号化して保存する仕組みで、ツール実行中に「思考の流れ」を維持するためのもの
- Gemini 2.5 では推奨だが必須ではなかったこの仕様が、Gemini 3.x で厳格に強制されるようになった
- **strands-agents v1.24.0** には `thought_signature` を `toolUse` ブロックに伝搬する実装が存在しなかった

## 解決方法

`strands-agents` を **v1.27.0** にアップグレード（2026-02-19リリース、[PR #1703](https://github.com/strands-agents/sdk-python/pull/1703) で修正）

### 変更内容

`pyproject.toml`:

```diff
-    "strands-agents[gemini]>=0.1.0",
+    "strands-agents[gemini]>=1.27.0",
```

### 適用コマンド

```bash
uv pip install -e ".[dev]"
```

## 参考

- [Vertex AI Thought Signatures ドキュメント](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/thought-signatures)
- [strands-agents SDK PR #1703](https://github.com/strands-agents/sdk-python/pull/1703)
