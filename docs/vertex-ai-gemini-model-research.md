# Vertex AI Gemini モデル調査レポート

調査日: 2026-02-22

## 調査目的

Google Cloud Vertex AI で利用可能な Gemini モデルの最新バージョンを確認し、特に「gemini-3.1-pro」というモデルIDの正確性を検証する。

---

## 結論

**「gemini-3.1-pro」というモデルIDは存在しない。** 正しいモデルIDは **`gemini-3.1-pro-preview`** である。

Gemini 3.1 Pro は 2026年2月19日にリリースされた最新モデルであり、現時点では **Preview（プレビュー）** ステータスで提供されている。GA（一般提供）版はまだリリースされていないため、モデルIDには `-preview` サフィックスが付く。

---

## Vertex AI で利用可能な Gemini モデル一覧（2026年2月時点）

### Preview モデル（プレビュー）

| モデル名 | モデルID（API用） | リリース日 | 説明 |
|---------|------------------|-----------|------|
| Gemini 3.1 Pro | `gemini-3.1-pro-preview` | 2026-02-19 | 最新の推論特化モデル。複雑なエージェントワークフローとコーディングに最適化。1Mトークンコンテキスト |
| Gemini 3 Flash | `gemini-3-flash-preview` | 2025後半〜2026 | 複雑なマルチモーダル理解に最適。Pro級の推論をFlash級の速度で提供 |
| Gemini 3 Pro Image | `gemini-3-pro-image-preview` | 2025後半〜2026 | 高忠実度の画像生成。推論強化された構図で、テキストレンダリングや複数画像編集に対応 |

### GA モデル（一般提供）

| モデル名 | モデルID（API用） | リリース日 | 廃止予定日 | 説明 |
|---------|------------------|-----------|-----------|------|
| Gemini 2.5 Pro | `gemini-2.5-pro` | 2025-06-17 | 2026-06-17 | 高性能推論・コーディングモデル。アダプティブシンキング対応。1Mトークン |
| Gemini 2.5 Flash | `gemini-2.5-flash` | 2025-06-17 | 2026-06-17 | 高速・高性能のバランスモデル。思考バジェットの制御が可能 |
| Gemini 2.5 Flash-Lite | `gemini-2.5-flash-lite` | 2025-07-22 | 2026-07-22 | 大規模処理向け。コストとパフォーマンスのバランスに最適化 |
| Gemini 2.5 Flash Image | `gemini-2.5-flash-image` | 2025-10-02 | 2026-10-02 | 画像生成・会話的編集機能。マルチ画像融合に対応 |
| Gemini 2.0 Flash | `gemini-2.0-flash-001` | 2025-02-05 | 2026-06-01 | マルチモーダル汎用モデル（廃止予定） |
| Gemini 2.0 Flash-Lite | `gemini-2.0-flash-lite-001` | 2025-02-25 | 2026-06-01 | 軽量・高頻度タスク向け（廃止予定） |

### 廃止予定に関する注意

- Gemini 2.0 Flash / Flash-Lite は **2026年3月31日** に廃止予定
- 廃止1ヶ月前から新規アクセスがブロックされる
- 廃止後は 404 エラーが返却される

---

## Gemini 3.1 Pro の詳細

### 主な特徴

- **アダプティブシンキング**: 問題の複雑さに応じて推論の深さを自動調整
- **1Mトークン コンテキストウィンドウ**: 大規模データセットやコードリポジトリ全体の処理が可能
- **統合グラウンディング**: 高度なマルチモーダル問題解決のための情報基盤
- **対応モダリティ**: テキスト、音声、画像、動画、PDF、コードリポジトリ

### 価格（プレビュー版）

| 項目 | 200Kトークン以内 | 200Kトークン超 |
|------|-----------------|---------------|
| 入力 | $2 / 100万トークン | $4 / 100万トークン |
| 出力 | $12 / 100万トークン | $18 / 100万トークン |

### 利用可能なプラットフォーム

- Google AI Studio
- Vertex AI
- Gemini Enterprise
- Gemini CLI
- Android Studio
- Google Antigravity

---

## 本プロジェクト（Slidev Agent）への影響

### 修正が必要な箇所

現在の `docs/vertex-ai-gemini-spec.md` では、モデルIDが `gemini-3.1-pro` と記載されているが、正しくは `gemini-3.1-pro-preview` に修正する必要がある。

#### 修正対象

| ファイル | 現在の値 | 正しい値 |
|---------|---------|---------|
| `docs/vertex-ai-gemini-spec.md` | `gemini-3.1-pro` | `gemini-3.1-pro-preview` |
| `src/slidev_agent/agent.py`（実装時） | `gemini-3.1-pro` | `gemini-3.1-pro-preview` |

#### 環境変数のデフォルト値

```python
# 修正前
model_id = os.getenv("GEMINI_MODEL_ID", "gemini-3.1-pro")

# 修正後
model_id = os.getenv("GEMINI_MODEL_ID", "gemini-3.1-pro-preview")
```

### 注意事項

1. **プレビュー版**: Gemini 3.1 Pro は現時点でプレビュー版のみ提供。GA版リリース時にモデルIDが `gemini-3.1-pro` に変更される可能性が高い
2. **安定性**: プレビュー版はプロダクション用途には推奨されない。安定版が必要な場合は `gemini-2.5-pro`（GA）を推奨
3. **フォールバック**: Preview モデルが不安定な場合に備え、`GEMINI_MODEL_ID` 環境変数でモデルを切り替えられる設計を維持すべき

---

## 参考資料

- [Gemini 3.1 Pro - Vertex AI ドキュメント](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-1-pro)
- [Google Models 一覧 - Vertex AI](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models)
- [Model versions and lifecycle](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/model-versions)
- [Gemini 3.1 Pro 発表ブログ](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-1-pro/)
- [Gemini 3.1 Pro on Vertex AI - Google Cloud Blog](https://cloud.google.com/blog/products/ai-machine-learning/gemini-3-1-pro-on-gemini-cli-gemini-enterprise-and-vertex-ai)
- [Get started with Gemini 3](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/start/get-started-with-gemini-3)
- [Gemini 3 Flash - Vertex AI](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-flash)
