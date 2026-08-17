# Bedrock AgentCore Payments をサブスク型で活用するプラン

作成日: 2026-05-11
対象プロジェクト: slidev-agent（AgentCore Runtime + Amplify Hosted Next.js Web UI で動作するスライド自動生成エージェント）

---

## 0. エグゼクティブサマリー

「Bedrock AgentCore Payments をサブスクの形で活用する」という要件は、**そのままでは現プレビュー仕様と整合しない**ことが調査で判明した。AgentCore Payments（2026年5月7日 Preview 発表）は **x402 / USDCベースの「エージェントが外部API/MCPを買う」マイクロ決済**に特化しており、**ネイティブな定期課金 (recurring subscription) 機能を持たない**。

そのため本プランでは、要件を **2層に分解** して整合する設計を提案する。

| 層 | 課金主体 | 課金先 | 採用技術 |
|---|---|---|---|
| **L1: SaaS サブスクリプション層** | エンドユーザー (人間) | slidev-agent サービス事業者 | **Stripe Billing + Cognito**（AgentCore Paymentsではない） |
| **L2: エージェント決済層** | slidev-agent (AIエージェント) | 外部有料API・MCP (画像素材, フォント, 翻訳API 等) | **AgentCore Payments (x402 / Coinbase or Stripe Privy)** |

L1 を「**メータード・サブスク**」として実装し、ユーザーが契約したプラン上限の範囲内で L2 のエージェント決済コストを **パススルー（または含み）** で吸収する。これによりユーザーから見れば「月額〇〇円のサブスク」、内部的にはエージェントが必要な有料リソースを自律的に購入する、という二段構造のビジネスモデルが実現する。

これは **AgentCore Payments の本来の設計思想（エージェントの自律購買）** と **SaaS サブスクリプションビジネスの収益モデル** の両方を矛盾なく成立させる、現時点で唯一妥当な構成である。

---

## 1. 背景: なぜ「サブスク」をそのまま AgentCore Payments で実装できないのか

### 1.1 AgentCore Payments の設計範囲

| 項目 | 内容 |
|---|---|
| ステータス | Public Preview (2026-05-07 発表) |
| リージョン | us-east-1 / us-west-2 / eu-central-1 / ap-southeast-2 |
| プロトコル | x402 (HTTP 402 ベースのオープン決済標準) |
| 通貨 | USDC（ステーブルコイン）が主、Stripe Privy 経由で法定通貨チャージ可 |
| プロバイダ | Coinbase CDP / Stripe Privy |
| 課金モデル | **ペイパーユース型のマイクロ決済のみ** |
| 定期課金 | **❌ ネイティブ非対応**（ロードマップでも未公表） |
| 課金単位 | `PaymentSession` ごとの予算上限内での個別取引 |
| カードホルダーデータ | AgentCore は保持しない（PCI DSS スコープ軽減） |

### 1.2 「サブスク」の主体が逆である

- AgentCore Payments の世界観: **エージェント → 外部マーチャント** に支払う
- 通常のSaaSサブスクの世界観: **エンドユーザー → SaaSベンダー** に支払う

両者は方向が逆であり、AgentCore Payments を SaaS の月額課金エンジンに転用するのは不適切。`PaymentInstrument` は「エージェント側のウォレット」であり、ユーザーから定期的に引き落とすクレジットカード・サブスクの管理機構ではない。

### 1.3 結論

> **L1 (SaaSサブスク) は Stripe Billing で、L2 (エージェントの外部購買) は AgentCore Payments で実装し、両者をクレジット制（メータード）で接続するハイブリッド構成が最適解。**

---

## 2. プラン全体像

### 2.1 アーキテクチャ概念図

```
┌─────────────────────────────────────────────────────────────────────────┐
│  [ End User (Browser) ]                                                 │
│         │                                                               │
│         │ ① Sign Up / Login (Cognito Hosted UI)                         │
│         │ ② Subscribe (Stripe Checkout)                                 │
│         ▼                                                               │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Amplify Hosted Next.js Web UI                                   │   │
│  │   - Cognito User Pool 連携 (Auth)                                │   │
│  │   - Stripe Customer Portal リンク                                │   │
│  │   - "Generate Slides" UI                                         │   │
│  └────────────────────────┬─────────────────────────────────────────┘   │
│                           │ ③ Invoke (JWT + plan_id + credit_balance)   │
│                           ▼                                             │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  AgentCore Runtime (slidev-agent)                                │   │
│  │   ┌─── Plan Gate (Lambda Authorizer 等で plan/credit を判定)      │   │
│  │   ├─── Strands Agent (Claude Opus 4.7 or Gemini 3.1 Pro)         │   │
│  │   ├─── AgentCore Memory (履歴・ユーザー設定)                       │   │
│  │   └─── Tools                                                     │   │
│  │         ├── slidev compile                                       │   │
│  │         ├── image search (有料素材) ──┐                           │   │
│  │         ├── translation API ─────────┤  x402 endpoints           │   │
│  │         └── premium font CDN ────────┘                           │   │
│  └────────────────────────┬─────────────────────────────────────────┘   │
│                           │ ④ 402 Payment Required                      │
│                           ▼                                             │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  AgentCore Payments                                              │   │
│  │   - PaymentManager (env / tenant 単位)                           │   │
│  │   - PaymentConnector (Stripe Privy or Coinbase CDP)              │   │
│  │   - PaymentSession (リクエストごとの予算上限)                       │   │
│  │   - PaymentInstrument (EMBEDDED_CRYPTO_WALLET)                   │   │
│  └────────────────────────┬─────────────────────────────────────────┘   │
│                           │ ⑤ 自動署名 → USDC 支払 → 証明取得             │
│                           ▼                                             │
│                  External Paid API / MCP (x402 対応)                    │
│                                                                         │
│  ─── 並行系統 ───                                                        │
│  ⑥ Stripe Webhook → invoice.paid / customer.subscription.updated        │
│     → Lambda → DynamoDB (UserCredit テーブル) を加算                     │
│  ⑦ AgentCore 起動毎に DynamoDB を参照 / 減算                              │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 主要コンポーネントと役割

| # | コンポーネント | 役割 | 既存/新規 |
|---|---|---|---|
| 1 | Amazon Cognito User Pool | エンドユーザー認証 | 新規 |
| 2 | Stripe Billing (Products / Prices / Subscriptions) | L1 サブスク課金（人間 → SaaS） | 新規 |
| 3 | Stripe Webhook → Lambda → DynamoDB (UserCredit) | サブスク → クレジット変換 | 新規 |
| 4 | AgentCore Runtime (slidev-agent) | 既存スライド生成エージェント | 既存 |
| 5 | Plan Gate (Lambda Authorizer) | クレジット残・プラン階層をチェック | 新規 |
| 6 | AgentCore Memory | ユーザーごとの履歴・嗜好 | 既存 |
| 7 | **AgentCore PaymentManager (tenant or env単位)** | L2 エージェント決済 | 新規 |
| 8 | **AgentCore PaymentConnector (Stripe Privy)** | 法定通貨チャージ可能なウォレット | 新規 |
| 9 | AgentCore Identity | Stripe/Coinbase の秘密鍵管理 | 既存 |
| 10 | DynamoDB Tables: `UserCredit`, `UsageLog`, `WalletAllocation` | 内部の課金原資管理 | 新規 |

---

## 3. サブスクプラン設計（L1: ユーザー向け）

### 3.1 プラン階層

| プラン | 月額(税抜) | 月間生成回数 | 1回あたり上限スライド枚数 | エージェント外部購買枠 (USDC換算) | 高度モデル (Opus 4.7 / Gemini 3.1) |
|---|---|---|---|---|---|
| **Free** | $0 | 5回 | 10枚 | $0（外部購買不可） | ❌ Haiku 4.5 のみ |
| **Starter** | $19 | 50回 | 20枚 | $2.00 / 月 | △ Sonnet 4.6 |
| **Pro** | $49 | 300回 | 50枚 | $10.00 / 月 | ✅ Opus 4.7 / Gemini 3.1 Pro |
| **Team** | $199 | 2,000回 + 5シート | 100枚 | $50.00 / 月 + 共有プール | ✅ + 並列実行枠 |
| **Enterprise** | 個別見積 | 無制限/プール | 個別 | 個別契約 + 単独 PaymentManager | ✅ + 専用VPCE / PrivateLink |

### 3.2 「外部購買枠」の意味

これが本プランの核となる差別化要素。

- 各プランに **「エージェントが x402 経由で有料API/素材を購入してよい月額予算」** が含まれる
- 内部 DynamoDB の `UserCredit.usdcAllowanceRemaining` で管理
- エージェントが生成時に有料素材（プレミアム画像、商用フォント、業界統計データ等）を必要と判断 → AgentCore Payments で購買 → ユーザーのクレジットから減算
- **ユーザーはサブスク料金以外を一切意識しない**（パススルー型）
- 枠超過時はエージェントが有料リソース利用を諦め、無料代替に自動フォールバック

### 3.3 オーバージア（追加クレジット）

- Pro 以上は枠超過時に **$5 / 追加 $1 相当 USDC** などの追加クレジット購入を可（Stripe Checkout で都度購入）
- これは「ペイパーユースの追加チャージ」であり、サブスク本体とは別請求

---

## 4. L2 設計: AgentCore Payments の組み込み詳細

### 4.1 マルチテナント方式の選択

| 方式 | 説明 | メリット | デメリット | 推奨適用先 |
|---|---|---|---|---|
| **A. 単一 PaymentManager + ユーザー別 PaymentSession** | サービス全体で1つの PaymentManager / Instrument を持ち、ユーザーごとに Session の予算上限で隔離 | 運用シンプル / コスト効率高 | 単一ウォレットなので会計分離・監査性弱い | **Free / Starter / Pro 推奨** |
| **B. テナント別 PaymentManager** | テナント（または Team プラン顧客）ごとに PaymentManager と Instrument を作成 | 完全分離 / 監査容易 / Enterprise 要件適合 | プロビジョニング自動化必要 | **Team / Enterprise 推奨** |
| **C. プラン別 PaymentManager** | Pro 用 / Team 用 でリソース分離 | 段階的に B へ移行可 | 半端 | 中間ステップとして可 |

**推奨: A 方式で MVP リリース → 利用増 / Enterprise 案件で B 方式に拡張**

### 4.2 PaymentSession のライフサイクル

エージェント起動 1 リクエストごとに以下を実行:

```python
# Pseudocode (Strands Agents in slidev-agent)
def on_request(user_id: str, slide_prompt: str):
    user = get_user(user_id)
    remaining = user.usdc_allowance_remaining  # DynamoDB から取得

    # PaymentSession を per-request で作成
    session = payment_client.create_payment_session(
        paymentManagerArn=PM_ARN,
        paymentInstrumentArn=PI_ARN,
        maxSpendAmount=min(remaining, request_cap),  # 例: min(2.00, 0.50) USDC
        currency="USDC",
        expiryDuration="PT10M",
        metadata={"userId": user_id, "plan": user.plan},
    )

    try:
        agent_result = run_strands_agent(
            prompt=slide_prompt,
            payments_plugin=AgentCorePaymentsPlugin(session_arn=session.arn),
        )
        spent = payment_client.get_payment_session(session.arn).amountSpent
        decrement_user_credit(user_id, spent)
        log_usage(user_id, spent, agent_result.metadata)
    finally:
        payment_client.delete_payment_session(session.arn)

    return agent_result
```

要点:
- **per-request session** にすることでユーザー間の予算リーク・暴走を防止
- セッション失効を待たず `DeletePaymentSession` で確実にクローズ（コスト統制）
- 失敗時は AgentCore が自動ロールバックするため、課金漏れ・二重課金は基本起こらないが、念のため DynamoDB 側で **idempotency key** を発行

### 4.3 ウォレットチャージ運用

- **Stripe Privy コネクタを採用**: 法定通貨 (USD/JPY) で AWS 運営者がチャージ可能 → 内部運用が楽
- 月次バッチで PaymentInstrument 残高を監視 (`GetPaymentInstrumentBalance`)
- 閾値 (例: $200) を下回ったら CloudWatch Alarm → SNS → 運用者通知 → Stripe Privy で追加チャージ
- チャージは AWS 運営者の責任で、エンドユーザーは関与しない（パススルー設計のため）

### 4.4 x402 エンドポイント発見

- Coinbase x402 Bazaar MCP サーバーを AgentCore Gateway 経由で接続
- slidev-agent の生成ロジックで「プレミアムが必要」と判断したら Bazaar から候補を検索 → 安価な代替を優先選択するロジックを実装（コスト最適化）

---

## 5. L1 設計: Stripe Billing 連携の要点

### 5.1 Stripe オブジェクト構成

| Stripe オブジェクト | slidev-agent での意味 |
|---|---|
| Customer | Cognito User と 1:1 (`sub` をメタデータ保存) |
| Product | "slidev-agent" |
| Price | プラン毎 (Starter / Pro / Team) の Recurring Price |
| Subscription | アクティブな契約 |
| Invoice / Webhook | クレジット加算トリガー |

### 5.2 Webhook イベント処理

| イベント | アクション |
|---|---|
| `customer.subscription.created` | DynamoDB に `plan`, `usdcAllowanceRemaining` を初期化 |
| `invoice.paid` | 月次のクレジット枠リフィル |
| `customer.subscription.updated` | プランアップ/ダウンを反映 (枠を即時調整) |
| `customer.subscription.deleted` | Free プランに降格 |
| `invoice.payment_failed` | Grace period 後にプラン停止 |

### 5.3 Cognito との結合

- Cognito Pre Token Generation Lambda Trigger で JWT に `plan` / `credit` クレームを注入
- AgentCore Runtime 側の Lambda Authorizer (または Inbound Identity) がプランチェック → 高度モデルへのアクセス制御

---

## 6. データモデル (DynamoDB)

### 6.1 `UserCredit` テーブル

| 属性 | 型 | 説明 |
|---|---|---|
| `userId` (PK) | S | Cognito sub |
| `plan` | S | free / starter / pro / team / enterprise |
| `monthlyGenerationsRemaining` | N | 月間生成回数の残 |
| `usdcAllowanceRemaining` | N | x402 経由購買の残 USDC |
| `usdcAllowanceMonthlyRefill` | N | プラン契約時の月次リフィル量 |
| `subscriptionStatus` | S | active / past_due / canceled |
| `stripeCustomerId` | S | Stripe Customer ID |
| `currentPeriodEnd` | N | epoch (リフィルジョブで参照) |
| `tenantId` | S | Team / Enterprise の場合 |

### 6.2 `UsageLog` テーブル (時系列)

| 属性 | 型 | 説明 |
|---|---|---|
| `userId` (PK) | S | |
| `timestamp` (SK) | N | |
| `requestId` | S | idempotency key |
| `agentRuntimeArn` | S | |
| `paymentSessionArn` | S | x402 を使った場合 |
| `usdcSpent` | N | |
| `endpointsPaid` | L | x402 マーチャント情報 |
| `modelUsed` | S | claude-opus-4-7 等 |

---

## 7. 料金モデル / 損益試算

### 7.1 コスト構造（Pro プラン $49/月 のユーザー1名あたり、月300回利用想定）

| 項目 | 単価 | 月額試算 | 備考 |
|---|---|---|---|
| Bedrock (Claude Opus 4.7) | 入力 $15/1M, 出力 $75/1M | $18.00 | 1回平均 in 8K / out 4K トークン想定 |
| AgentCore Runtime | invoke 0.001USD相当 | $0.30 | |
| AgentCore Memory | $0 | $0 | 無料枠想定 |
| AgentCore Payments (Stripe Privy) | AWS側無料 / Coinbase 操作 $0.005/op | $0.50 | 100操作想定 (Coinbase時) |
| **x402 経由の外部購買** | 平均$0.02/operation × 300 | **$6.00** (実費はユーザー枠 $10 から減算) | プラン枠内で吸収 |
| Stripe 手数料 | 3.6% + ¥40 | $1.80 | |
| Amplify Hosting / DynamoDB / Lambda | | $1.50 | |
| **コスト合計** | | **$28.10** | |
| **粗利** | | **$20.90 (≒42%)** | |

### 7.2 健全性指標

- **AgentCore Payments 経由の購買コストはサブスク枠を超過しない設計** なので、純粋にメータード制限の中で利益が確定する
- USDC レートのボラティリティ対策として **月次でレートを固定 (snapshot)** し、内部仕訳に使う（実際の決済は USDC、社内仕訳は USD 換算固定）

---

## 8. 段階的ロードマップ

### Phase 0: 現状 (済)
- AgentCore Runtime に slidev-agent をデプロイ
- Amplify で Next.js Web UI を公開
- ユーザー認証なし / 課金なし

### Phase 1 (2026 Q2 / 1〜2 ヶ月): 認証 + サブスク基盤
1. Cognito User Pool 導入、Amplify と連携
2. Stripe Billing で Free / Starter / Pro を定義
3. Stripe Checkout / Customer Portal 統合
4. DynamoDB `UserCredit` テーブル + Webhook Lambda
5. AgentCore Runtime 側に Lambda Authorizer 追加（プランチェックのみ）
6. **この段階では AgentCore Payments は未統合（外部購買枠 = 0 で機能無効化）**

**マイルストーン**: 「Free / Starter / Pro が買えて、生成回数制限が効く」状態

### Phase 2 (2026 Q3 / 2〜3 ヶ月): AgentCore Payments 統合
1. Stripe Privy で PaymentConnector を作成 (us-west-2)
2. 単一 PaymentManager + PaymentInstrument 構成 (方式 A)
3. Strands Agent に `AgentCorePaymentsPlugin` を組み込み
4. per-request PaymentSession 生成ロジック
5. x402 Bazaar MCP を AgentCore Gateway で接続
6. プレミアム画像素材 (Shutterstock x402 等) / 商用フォント / 翻訳 API を選択肢に追加
7. DynamoDB `UsageLog` 整備、CloudWatch ダッシュボード

**マイルストーン**: 「Pro ユーザーはエージェントが自動で有料素材を仕入れて高品質スライドを生成する」状態

### Phase 3 (2026 Q4 / 2 ヶ月): Team / Enterprise
1. テナント別 PaymentManager (方式 B) への切り替え機構
2. Team プラン (シート共有、共有クレジットプール)
3. SSO (SAML / OIDC) サポート
4. Enterprise 向け PrivateLink / VPC エンドポイント
5. 監査ログ S3 エクスポート、Cost Explorer タグ整備

### Phase 4 (2027 H1): GA 移行・運用最適化
1. AgentCore Payments の GA 化追随（仕様変更があれば吸収）
2. AgentCore Payments がもしネイティブ recurring payment を提供したら、ユーザー追加クレジットの自動引落しに利用
3. マルチリージョン (us-east-1, eu-central-1) 展開
4. 多通貨対応 (JPY / EUR)

---

## 9. リスクと緩和策

| リスク | 影響度 | 緩和策 |
|---|---|---|
| AgentCore Payments がプレビューのため仕様変更 | 高 | API レイヤを抽象化し `payments_adapter.py` でラップ。GA 時の差分吸収。 |
| USDC レート変動でコスト予測ブレ | 中 | 月次レート固定で社内仕訳 / Stripe Privy 経由のチャージは法定通貨で実施 |
| エージェントの暴走購買 | 高 | per-request PaymentSession + maxSpendAmount + プラン枠 + idempotency key + CloudWatch Alarm の4層防御 |
| Free ユーザーの濫用 | 中 | Cognito Group + Lambda Authorizer で外部購買完全禁止 |
| PCI DSS 適用範囲拡大 | 中 | カードホルダーデータは Stripe Checkout 内で完結 / AgentCore Payments はステーブルコイン経由なので AWS 側に PII 持たない |
| x402 マーチャントの可用性 | 中 | Bazaar から複数候補取得 → リトライ + 無料代替へのフォールバック |
| サブスク解約時のウォレット残高 | 低 | 個人ウォレットを持たない設計（単一プール方式 A）なので問題発生せず |
| リージョン制約 (4リージョンのみ) | 中 | 当面 us-west-2 をマスターに統一。ap-southeast-2 を DR 検討 |

---

## 10. 意思決定ポイント (要レビュー)

以下は本プランで「決め」が必要な項目。最終承認前にステークホルダーで合意すべき。

1. **コネクタの選定**: Stripe Privy (法定通貨ベース、運用楽) を推奨。Coinbase CDP (USDC直、技術先進性アピール) を併用するか
2. **マルチテナント方式**: MVP は方式 A (単一PM) で開始 → Team プラン投入時に B へ移行で合意するか
3. **Free プランで外部購買を完全禁止するか**: 推奨は完全禁止（コスト保護）
4. **メータード制 vs 真のサブスク**: 提案は「メータード型サブスク」(月内に枠を使い切れる)。完全定額（無制限）にする場合は別途プラン設計が必要
5. **多通貨対応の優先度**: Phase 4 で良いか、Phase 2 から JPY を出すか
6. **AgentCore Payments GA 待ち戦略**: Phase 2 を Preview 期間中にローンチするか、GA を待つか（GA 予定は未公表のため、Preview のうちに技術検証を始めることを推奨）

---

## 11. まとめ

- **AgentCore Payments を「サブスク課金エンジン」として直接使うことはできない**（x402 / pay-per-use 専用、recurring 非対応）
- ただし **「サブスクで集めた原資を、エージェントが外部購買する燃料に転換する」** という発想で再構築すれば、AgentCore Payments を **サブスクサービスの中核的な競争優位** として組み込める
- Stripe Billing (L1) + AgentCore Payments (L2) のハイブリッド構成により、「**ユーザーから見れば普通の月額制 SaaS、内部ではエージェントが自律的に有料リソースを購入する**」という、エージェント時代に固有の課金モデルが完成する
- slidev-agent の文脈では、これにより「Free は無料テンプレ＋無料モデル」「Pro はプレミアム画像・翻訳・最上位モデルが含まれた高品質スライド生成」と、**プラン差別化を技術的に裏付ける手段** として AgentCore Payments が機能する

---

## 付録 A: 用語

- **x402**: HTTP 402 (Payment Required) ステータスを使ったオープン決済プロトコル。Coinbase が主導しエコシステム化中
- **USDC**: Coinbase / Circle が発行する米ドルペッグのステーブルコイン
- **PaymentManager / Connector / Session / Instrument**: AgentCore Payments の4リソース概念
- **メータード・サブスク**: 定額の上限内でメーター制限が走る、SaaS で一般的な課金モデル

## 付録 B: 参照

- `research/ai-agentcore-payments.md` (本リポジトリ内、aws-researcher の詳細調査結果)
- AWS What's New: Amazon Bedrock AgentCore Payments Preview (2026-05-07)
- AgentCore Documentation: Payments セクション (us-west-2)
