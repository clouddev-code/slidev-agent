# Gemini モデルID修正レポート

## エラー内容

```
Error: 404 Not Found
Publisher Model `projects/infra-dev-392306/locations/us-central1/publishers/google/models/gemini-3.1-pro` was not found
```

## 原因

Gemini 3.1 Pro（2026年2月19日リリース）は現時点で**プレビュー版**としてのみ提供されており、APIで使用するモデルIDには `-preview` サフィックスが必須。

| 誤ったモデルID | 正しいモデルID |
|---------------|---------------|
| `gemini-3.1-pro` | `gemini-3.1-pro-preview` |

## 修正ファイル

| ファイル | 修正箇所 |
|---------|---------|
| `src/slidev_agent/agent.py` | デフォルトモデルIDを `gemini-3.1-pro-preview` に変更 |
| `.env.example` | コメント内のモデルIDを修正 |
| `docs/vertex-ai-gemini-spec.md` | 全てのモデルID参照を修正 |
| `docs/vertex-ai-gemini-implementation.md` | 全てのモデルID参照を修正 |

## 参考: 利用可能なGeminiモデル一覧（2026年2月時点）

### プレビューモデル

| モデル名 | モデルID |
|---------|---------|
| Gemini 3.1 Pro | `gemini-3.1-pro-preview` |
| Gemini 3 Flash | `gemini-3-flash-preview` |
| Gemini 3 Pro Image | `gemini-3-pro-image-preview` |

### GA（安定版）モデル

| モデル名 | モデルID |
|---------|---------|
| Gemini 2.5 Pro | `gemini-2.5-pro` |
| Gemini 2.5 Flash | `gemini-2.5-flash` |
| Gemini 2.5 Flash-Lite | `gemini-2.5-flash-lite` |

## 備考

- Gemini 3.1 ProがGA版になった際にモデルIDが `gemini-3.1-pro` に変わる可能性があるため、環境変数 `GEMINI_MODEL_ID` での切り替えを推奨
- 安定性を重視する場合は、GA版の `gemini-2.5-pro` の利用も検討可能
