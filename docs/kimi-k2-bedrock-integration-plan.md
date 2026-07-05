# Bedrock 経由で Kimi K2 系を使う場合の変更方針

- 対象ブランチ: `feature/kimi-k2-support`
- 作成日: 2026-05-09
- 関連ファイル: `src/slidev_agent/agent.py`, `src/slidev_agent/runtime.py`, `pyproject.toml`, `.env.example`, `README.md`, `agentcore.yaml`

---

## 0. 結論サマリ (TL;DR)

- **Kimi K2.6 (2026-04-20 リリース) は本日 (2026-05-09) 時点で Amazon Bedrock では未提供**。Bedrock で利用できる Moonshot 系は `moonshotai.kimi-k2.5` と `moonshot.kimi-k2-thinking` の2種のみ。
- Strands Agents の `BedrockModel` は **Converse API ベース**で、`model_id` を差し替えるだけで Kimi を呼べる。新規 Provider 実装・新規依存追加は不要。
- 必要な変更は **「`BEDROCK_MODEL_ID` の差し替え + IAM 権限 + リージョン考慮 + 既知の互換性課題対策」** の4点。コードの構造変更はほぼ不要。
- K2.6 が将来 Bedrock に来た場合も「`BEDROCK_MODEL_ID=moonshotai.kimi-k2.6` に変えるだけ」で動く設計にしておく。

---

## 1. Bedrock における Kimi K2 系モデルの現状 (2026-05-09)

### 1.1 提供モデル一覧

| モデル | Bedrock Model ID (Converse/Invoke) | Bedrock Model ID (Chat Completions / `bedrock-mantle`) | リリース | Reasoning | 入力モダリティ | Context / Max Output |
| --- | --- | --- | --- | --- | --- | --- |
| Kimi K2.5 | `moonshotai.kimi-k2.5` | `moonshotai.kimi-k2.5` | 2026-01-27 | ❌ | Text + Image | 256K / 16K |
| Kimi K2 Thinking | **`moonshot.kimi-k2-thinking`** ⚠️ | `moonshotai.kimi-k2-thinking` | 2025-11-06 | ✅ | Text | 256K / 16K |
| Kimi K2.6 | (未提供) | (未提供) | Moonshot 直: 2026-04-20 | — | — | — |

> ⚠️ **Kimi K2 Thinking の ID 揺れ**: Invoke/Converse API では `moonshot.kimi-k2-thinking` (`ai` 抜け)、Chat Completions/`bedrock-mantle` では `moonshotai.kimi-k2-thinking`。AWS 公式ドキュメント上の表記揺れで、Strands `BedrockModel` (Converse) を使う場合は前者を指定する。

### 1.2 提供リージョン (In-Region 推論のみ。Geo / Global 非対応)

us-east-1 (N. Virginia), us-east-2 (Ohio), us-west-2 (Oregon), ap-northeast-1 (Tokyo), ap-south-1 (Mumbai), ap-southeast-2 (Sydney), ap-southeast-3 (Jakarta), ap-southeast-4 (Melbourne), sa-east-1 (São Paulo), eu-north-1 (Stockholm), eu-west-2 (London)

### 1.3 重要な制約

- **クロスリージョン推論プロファイル非対応**: 既存設定の `us.anthropic.claude-opus-4-6-v1` のような `us.` / `apac.` プレフィックスは Kimi では使えない。常に **bare model ID** を使う。
- **API**: Converse / InvokeModel / Chat Completions (`bedrock-mantle` 経由) 全対応。Responses API は非対応。
- **Service Tier**: Standard / Priority / Flex 対応、Reserved 非対応。
- **Tool use (function calling)**: Converse API の `toolUse` / `toolResult` ブロックでサポート。ただし下記の既知問題あり。

### 1.4 既知の互換性課題 (要警戒)

- 2026 年 Q1 に **「Kimi K2 / K2.5 on Bedrock の `toolResult` フォーマットエラー」「premature `end_turn`」「サービスリグレッション」** が複数報告されている (opencode/anomalyco の issue, AWS re:Post)。
  - 出典: AWS re:Post `Bedrock Kimi K2 / K2.5 Service Regression`、opencode/anomalyco issue #14221。
- マルチターンの tool call ループ (本プロジェクトの `validate_slides_fit` overflow ループ) で再現する可能性が高い。**スモークテストで真っ先に確認するポイント**。

---

## 2. プロジェクトへの影響範囲

| ファイル | 影響度 | 内容 |
| --- | --- | --- |
| `pyproject.toml` | なし | `BedrockModel` を経由するため新規依存不要 |
| `.env.example` | 小 | `BEDROCK_MODEL_ID` 候補に Kimi 系を明記、`AWS_REGION` 推奨値を案内 |
| `src/slidev_agent/agent.py` | 小 | コードロジックは無変更で OK。ただし `max_tokens` を Kimi のmax (16k) と揃える防御や、reasoning モード切替を加えるのが望ましい |
| `src/slidev_agent/runtime.py` | 小 | `runtime.py:21` でツール一覧から `validate_slides_fit` が抜けているバグも併せて修正推奨 |
| `agentcore.yaml` / IAM ポリシー | 中 | AgentCore Runtime 実行ロールに Kimi モデル ARN への `bedrock:InvokeModel` / `bedrock:Converse` 権限を追加 |
| `README.md` | 小 | Kimi 切替手順と既知制約を追記 |
| `tests/` | 小 | `BEDROCK_MODEL_ID` 切替のスモークテスト追加 |

---

## 3. 具体的な変更案

### 3.1 `.env.example`

```dotenv
# --- Bedrock Configuration ---
AWS_REGION=us-east-1

# Anthropic Claude (default)
BEDROCK_MODEL_ID=us.anthropic.claude-opus-4-6-v1

# Moonshot AI Kimi 系 (Bedrock 提供分)
#   ※ クロスリージョン推論非対応のため "us." プレフィックスは付けない
#   ※ AWS_REGION は us-east-1 / us-west-2 / ap-northeast-1 等の対応リージョンを指定
# BEDROCK_MODEL_ID=moonshotai.kimi-k2.5            # 非 Reasoning, Text+Image
# BEDROCK_MODEL_ID=moonshot.kimi-k2-thinking       # Reasoning ON, Converse 用 ("ai" なし注意)
# BEDROCK_MODEL_ID=moonshotai.kimi-k2.6            # 将来 Bedrock 提供時 (現状未提供)
```

> K2.6 が Bedrock に正式追加された日に、`BEDROCK_MODEL_ID` の値を差し替えるだけで切り替え完了する。

### 3.2 `src/slidev_agent/agent.py` の `create_model()`

最小差分。**コードはほぼそのまま** で動くが、Kimi の制約に合わせた防御を入れる。

```python
def create_model(provider: str | None = None):
    provider = provider or os.getenv("MODEL_PROVIDER", "bedrock")

    if provider == "vertexai":
        from strands.models.gemini import GeminiModel
        model_id = os.getenv("GEMINI_MODEL_ID", "gemini-3.1-pro-preview")
        return GeminiModel(model_id=model_id, max_tokens=16384)

    # bedrock (Anthropic / Kimi 共通)
    model_id = os.getenv("BEDROCK_MODEL_ID", "us.anthropic.claude-opus-4-6-v1")
    region = os.getenv("AWS_REGION", "us-east-1")

    # Kimi 系: クロスリージョン推論プロファイル非対応のため、"us." 等の
    # プレフィックスを誤って付与しているケースを早期検知
    if model_id.startswith(("moonshot.", "moonshotai.")) and "." in model_id.split(".", 1)[0]:
        # OK: bare ID 形式
        pass
    elif model_id.startswith(("us.moonshot", "apac.moonshot", "eu.moonshot")):
        raise ValueError(
            "Moonshot Kimi models on Bedrock do not support cross-region inference "
            "profiles. Use the bare model ID (e.g., 'moonshotai.kimi-k2.5')."
        )

    # Kimi 系の Max Output は 16K 固定
    return BedrockModel(model_id=model_id, region_name=region, max_tokens=16384)
```

ポイント:

- **構造変更なし**。`BedrockModel` のままで Strands Agents は Converse API を使い、Kimi の Tool use もハンドリングする。
- 早期 ValidationError で、`us.moonshotai.kimi-k2.5` のような典型的タイポ (Claude の感覚での記述ミス) を検知。
- Reasoning モード (`moonshot.kimi-k2-thinking`) を使う場合、Strands `BedrockModel` は Converse の `reasoningConfig` をサポートしているので `additional_request_fields={"reasoning_config": {"type": "enabled"}}` を必要に応じて足す。**ただし Phase 1 では Reasoning を OFF にして K2.5 のみで運用** することを推奨 (既知 tool 互換性課題のリスクを抑えるため)。

### 3.3 IAM / モデルアクセス

#### 3.3.1 Bedrock コンソールでモデルアクセス申請

```
Bedrock Console → Model access → Moonshot AI →
  - Kimi K2.5 (リクエスト)
  - Kimi K2 Thinking (リクエスト) (任意)
```

#### 3.3.2 AgentCore Runtime 実行ロールのポリシー追加

既存ロールに以下を追記:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream",
        "bedrock:Converse",
        "bedrock:ConverseStream"
      ],
      "Resource": [
        "arn:aws:bedrock:us-east-1::foundation-model/moonshotai.kimi-k2.5",
        "arn:aws:bedrock:us-east-1::foundation-model/moonshot.kimi-k2-thinking"
      ]
    }
  ]
}
```

> リージョンは `AWS_REGION` に合わせて。複数リージョン許可する場合は `arn:aws:bedrock:*::foundation-model/moonshotai.kimi-k2.5` でも可。

#### 3.3.3 `agentcore.yaml`

`agentcore.yaml` は環境変数だけ調整 (シークレット系は Tavily のみで OK):

```yaml
env:
  AWS_REGION: us-east-1
  BEDROCK_MODEL_ID: moonshotai.kimi-k2.5
  MODEL_PROVIDER: bedrock
```

### 3.4 `runtime.py` の付随修正

別件だが Kimi 切替時のスモークで顕在化しやすいので併せて直す。

```diff
-     tools=[web_search, web_extract, write_slidev_markdown],
+     tools=[web_search, web_extract, write_slidev_markdown, validate_slides_fit],
```

これにより AgentCore 実行時も overflow ループが効くようになる。

### 3.5 `README.md`

`Environment Variables` の節に以下を追記:

```markdown
### Using Kimi K2 series via Amazon Bedrock

Set `BEDROCK_MODEL_ID` to one of the following (region must support the model):

| Model ID | Reasoning | Notes |
| --- | --- | --- |
| `moonshotai.kimi-k2.5` | No | Multimodal (text + image), 256K ctx, 16K out |
| `moonshot.kimi-k2-thinking` | Yes | Converse API uses `moonshot.` (no `ai`) |

> Cross-region inference profiles (`us.` prefix) are NOT supported for Kimi.
> Kimi K2.6 is not yet available on Bedrock as of 2026-05-09.
```

---

## 4. テスト方針

1. **環境変数差替テスト** (`tests/test_agent.py`):
    - `BEDROCK_MODEL_ID=moonshotai.kimi-k2.5` で `create_model()` が `BedrockModel` を期待引数で初期化することを検証 (boto3 モック)。
    - `BEDROCK_MODEL_ID=us.moonshotai.kimi-k2.5` で `ValueError` が出ることを検証。
2. **API スモーク** (CLI):
    - `BEDROCK_MODEL_ID=moonshotai.kimi-k2.5 slidev-agent "Bedrock の概要" -n 5`
    - `web_search` → `write_slidev_markdown` → `validate_slides_fit` のループが完走するか。
3. **Tool use 互換性検証** (本変更の最重要ポイント):
    - 意図的に overflow を起こすトピックを与え、`validate_slides_fit` が複数回呼ばれる状況で `toolResult` フォーマットエラーが起きないかを観察。
    - **再現したら**: ツール側で `result` を文字列化する、あるいは Strands を最新版に上げる、それでも解決しない場合は Phase 1 では Kimi をオプトイン扱いとし、`provider=bedrock` のデフォルトを Claude のままにする。
4. **クロス比較** (任意): Claude Opus 4.6 / Gemini 3.1 Pro / Kimi K2.5 で同一プロンプト 5 件を流し、生成品質・所要時間・トークン消費・スライド overflow 率を `docs/benchmark.md` に集計。

---

## 5. 既知のリスクと未確定事項

| 項目 | リスク | 対策 |
| --- | --- | --- |
| K2.6 が Bedrock 未提供 | ユーザー要望と現実が乖離 | Phase 1 では `moonshotai.kimi-k2.5` を採用。K2.6 提供後に env を差し替えるだけで対応可能な設計を担保 |
| `toolResult` 互換性問題 | overflow ループが破綻する可能性 | スモークテスト最優先。問題発生時は Strands を最新版へ。再現するなら Phase 1 ではフォールバックを Claude にする feature flag を残す |
| Reasoning モード時のツール呼び出し制約 | `kimi-k2-thinking` で `tool_choice` が `auto`/`none` 限定 | Phase 1 では Reasoning OFF (K2.5) のみサポート |
| クロスリージョン推論非対応 | スループットが上限に達するとリトライしかない | `runtime.py` の例外ハンドラに throttling リトライを追加 (今回スコープ外) |
| データガバナンス | Kimi は Moonshot AI (北京) 提供。Bedrock 経由でも EULA は要確認 | AWS Bedrock の Third-party model EULA を法務確認 |
| クォータ | 既定値が未公開かつ Reserved 不可 | 初期は Standard で運用、必要に応じ Priority/Flex に切替 |

---

## 6. 段階的ロールアウト計画

1. **Phase 1 (今回ブランチ)**: CLI で `BEDROCK_MODEL_ID=moonshotai.kimi-k2.5` をオプトインで動かす。`runtime.py` のツール抜けバグも合わせて修正。
2. **Phase 2**: AgentCore Runtime デプロイで Kimi を実機検証。IAM ポリシー追加。
3. **Phase 3**: ベンチ結果を踏まえ、デフォルト Provider を切替 / 並列利用 (例: ドラフトは Kimi K2.5、最終チェックは Claude) を検討。
4. **Phase 4**: K2.6 が Bedrock に追加されたら `BEDROCK_MODEL_ID=moonshotai.kimi-k2.6` に差し替え、再ベンチ。

---

## 7. 参考リンク

- Amazon Bedrock - Moonshot AI 一覧: <https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-moonshot-ai.html>
- Amazon Bedrock - Kimi K2.5 モデルカード: <https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-moonshot-ai-kimi-k2-5.html>
- Amazon Bedrock - Kimi K2 Thinking モデルカード: <https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-moonshot-ai-kimi-k2-thinking.html>
- Strands Agents - Amazon Bedrock Provider: <https://strandsagents.com/docs/user-guide/concepts/model-providers/amazon-bedrock/index.md>
- Moonshot Kimi K2.6 (Bedrock 未提供だが将来対応用): <https://platform.kimi.ai/docs/guide/kimi-k2-6-quickstart>
- AWS re:Post: Bedrock Kimi K2 / K2.5 Service Regression: <https://repost.aws/questions/QUo_45wX-DQMOSfJ6oQYVhgg/aws-support-bedrock-kimi-k2-k2-5-service-regression>
