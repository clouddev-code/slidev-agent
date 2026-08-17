# Amazon Bedrock AgentCore Payments 技術調査レポート

調査日: 2026-05-11

---

## 概要

Amazon Bedrock AgentCore Payments は、AIエージェントが自律的にマイクロ決済を実行するための完全マネージドサービスである。2026年5月7日にプレビューとして発表され、CoinbaseおよびStripe（Privy）とのパートナーシップのもとで構築されている。x402プロトコルを基盤とし、HTTP 402 レスポンスを受信したエージェントが自動的に決済を完了してコンテンツを取得するまでの全ライフサイクルを管理する。

---

## 1. 正式名称・提供形態・対応リージョン

**正式名称:** Amazon Bedrock AgentCore Payments

**提供形態:** パブリックプレビュー（2026年5月7日発表）。APIおよびサービス仕様は GA 前に変更される可能性がある。

**対応リージョン（プレビュー時点）:**
- US East (N. Virginia) — `us-east-1`
- US West (Oregon) — `us-west-2`
- Europe (Frankfurt) — `eu-central-1`
- Asia Pacific (Sydney) — `ap-southeast-2`

---

## 2. 主な機能と API

### 2.1 コアコンセプト

AgentCore Payments は4つのリソース概念で構成される。

**PaymentManager** はアカウント内の最上位リソースで、認証方式（`AWS_IAM` または `CUSTOM_JWT`）とサービスが引き受ける IAM ロールを持つ。作成時に AgentCore Identity 上のワークロードアイデンティティが自動プロビジョニングされる。本番・ステージング・開発など環境単位、またはチーム単位で分けて作成するのが推奨パターンである。

**PaymentConnector** は PaymentManager と外部ウォレットプロバイダを接続する。機密資格情報（APIキー、ウォレットシークレット）は AgentCore Identity 経由で AWS Secrets Manager に保管され、ARN で参照される。1つの PaymentManager に複数の PaymentConnector を持てる（Coinbase と Stripe の併用など）。

**PaymentSession** は単一エージェントインタラクションの決済コンテキストである。セッションごとに有効期限（expiry duration）と支出上限（`maxSpendAmount`・`currency`）を設定できる。上限到達またはセッション失効時点で以降の決済リクエストは拒否される。決済署名失敗時は予算が自動ロールバックされる。

**PaymentInstrument** はエージェントがマーチャントへの支払いに使う組み込み暗号ウォレットである。ブロックチェーンネットワークごとに独立したインスツルメントが必要で、現在サポートされるタイプは `EMBEDDED_CRYPTO_WALLET` のみ。ステータスは `INITIATED` → `ACTIVE` → `FAILED`/`DELETED` で推移する。

### 2.2 データプレーン API（主要オペレーション）

| API 操作 | 説明 |
|---|---|
| `CreatePaymentInstrument` | エージェント用の暗号ウォレットを新規作成する |
| `GetPaymentInstrument` / `ListPaymentInstruments` | ウォレット情報を取得・一覧する |
| `GetPaymentInstrumentBalance` | ウォレット残高を確認する |
| `CreatePaymentSession` | 予算上限と有効期限付きのセッションを開始する |
| `GetPaymentSession` / `ListPaymentSessions` | セッション情報を取得・一覧する |
| `DeletePaymentSession` | セッションを終了する |
| `ProcessPayment` | x402 ペイロードを受け取り、署名・決済実行・証明返却を行う |

### 2.3 エンドポイント探索

Coinbase x402 Bazaar MCP サーバーが AgentCore Gateway 経由で公開されており、10,000以上の x402 対応エンドポイントを検索・発見できる。エージェントはこのサーバーを使ってタスクに必要な有料 API を動的に探索できる。

---

## 3. 連携可能な決済プロバイダ

### 3.1 Coinbase CDP

Coinbase Developer Platform が x402 プロトコルインフラ、CDP ウォレット基盤、ステーブルコイン決済レールを提供する。エンドユーザーはステーブルコイン（USDC）でウォレットをチャージできる。コネクタタイプ: `CoinbaseCDP`。

### 3.2 Stripe（Privy）

Stripe の子会社である Privy が組み込みウォレットインフラを提供する。デビットカード・Apple Pay・Google Pay・ACH での法定通貨によるチャージに対応しており、エンドユーザーのオンボーディングが容易である。コネクタタイプ: `StripePrivy`。

### 3.3 サブスクリプション課金（recurring payment）への対応状況

**現時点（プレビュー）では、AgentCore Payments はサブスクリプション/定期課金をネイティブにはサポートしていない。** 対応しているのはペイパーユース型のマイクロ決済に限定される。各取引は個別の PaymentSession として扱われ、定期的な自動引き落とし機能は提供されていない。

将来のロードマップとして、エージェントがフライト予約・ホテル予約・マーチャントプラットフォームでの購入を代行するブロードコマースフローへの拡張が示されているが、具体的なサブスクリプション対応の時期は公表されていない。

---

## 4. 認証・認可の仕組み

### 4.1 AgentCore Identity との連携

AgentCore Payments は AgentCore Identity を資格情報のバックエンドとして使用する。決済プロバイダの API キーやウォレットシークレットは `PaymentCredentialProvider`（AgentCore Identity の専用クレデンシャルプロバイダ型）として登録され、AWS Secrets Manager に暗号化保存される。`ProcessPayment` 実行時に Identity の `GetResourcePaymentToken` API が呼ばれてトークンが取得される。

### 4.2 エンドユーザー認可フロー

エージェントがトランザクションを実行するには、事前にエンドユーザーがウォレットへのアクセスを明示的に承認する必要がある。エンドユーザーはウォレットハブにリダイレクトされ、そこでチャージと権限付与を行う。エージェントは常に明示的な許可の範囲内・セッション上限内でのみ動作し、資金への無制限アクセスは持たない。

### 4.3 PaymentManager の認証方式

PaymentManager 作成時に認証方式として `AWS_IAM`（SigV4）または `CUSTOM_JWT` を選択できる。4ロール IAM モデルが推奨されており、管理・マネジメント・実行・サービス操作の各ロールを分離することで最小権限を実現する。

### 4.4 Strands SDK との統合例

```python
from strands import Agent
from strands_tools import http_request
from bedrock_agentcore.payments.integrations.config import AgentCorePaymentsPluginConfig
from bedrock_agentcore.payments.integrations.strands.plugin import AgentCorePaymentsPlugin

config = AgentCorePaymentsPluginConfig(
    payment_manager_arn="arn:aws:bedrock-agentcore:us-west-2:123456789012:payment-manager/pm-abc123",
    user_id="test-user-123",
    payment_instrument_id="payment-instrument-xyz789",
    payment_session_id="payment-session-def456",
    region="us-west-2",
)

plugin = AgentCorePaymentsPlugin(config=config)
agent = Agent(
    system_prompt="You are a helpful assistant that can access paid APIs.",
    tools=[http_request],
    plugins=[plugin],
)

# HTTP 402 レスポンスを受信した際、エージェントが自動的に決済を実行する
agent("Access the premium endpoint at https://example.com/paid-api")
```

---

## 5. 料金体系

### 5.1 AWS 側の料金

**AgentCore Payments の利用自体に AWS からの追加料金は発生しない。**

### 5.2 ウォレットプロバイダ側の料金

ウォレット操作はプロバイダの公表料金が適用される。

| プロバイダ | CreateInstrument | ProcessPayment |
|---|---|---|
| Coinbase CDP | 1ウォレット操作 ($0.005) | 1ウォレット操作 ($0.005) |
| Stripe Privy | 無料 | 1ウォレット操作（Stripe 公表料金） |

Coinbase CDP のウォレット操作単価は公表時点で **$0.005/操作**。

### 5.3 関連インフラ料金

AgentCore Runtime（エージェント実行環境）や CloudWatch（ログ・トレース・メトリクス）は別途費用が発生する。Runtime は vCPU 時間・メモリ GB 時間ベースの従量課金で、アイドル時間は無料である。

---

## 6. アーキテクチャ：他 AgentCore コンポーネントとの関係

### 6.1 コンポーネント構成図

```
エンドユーザー
    │ ウォレット承認・チャージ
    ▼
AgentCore Runtime  ─── AgentCore Identity ────► Secrets Manager
    │ エージェント実行          (PaymentCredentialProvider)
    │
    ▼
AgentCore Payments
    │ PaymentManager / PaymentConnector / PaymentSession
    │
    ├─► Coinbase CDP Wallet ──► x402 マーチャント
    └─► Stripe Privy Wallet ──► x402 マーチャント
    │
    ├─► AgentCore Gateway（Coinbase x402 Bazaar MCP経由でエンドポイント探索）
    ├─► AgentCore Browser（有料ウェブサイトへのアクセス）
    └─► AgentCore Observability（CloudWatch Logs・X-Ray・メトリクス）
```

### 6.2 各コンポーネントの役割

**Runtime** はエージェントをサーバーレス環境で実行し、真のセッション分離を提供する。Payments と組み合わせることで、エージェントが安全に資金を扱えるサンドボックスが確立される。

**Identity** は PaymentCredentialProvider として機密情報を管理し、`GetResourcePaymentToken` API でランタイム時に一時トークンを提供する。エージェントコードが秘密鍵に直接アクセスすることはない。

**Gateway** は有料 MCP サーバーへのセキュアなアクセスを仲介する。Coinbase x402 Bazaar との既存統合により、数万のエンドポイントを即座に利用できる。

**Browser** と組み合わせることで、x402 に対応した有料ウェブサイトへの自律的なアクセスが可能になる。

**Observability** は CloudWatch Logs（ベンディングログ）・X-Ray（トレーススパン）・CloudWatch Metrics を統合し、支払いサイクル全体の可視化を実現する。

---

## 7. x402 プロトコルの技術詳細

x402 は Coinbase が策定したオープン HTTP ネイティブ決済標準で、長年「未使用」だった HTTP 402 ステータスコードを復活させたものである。

決済フローは以下のステップで進む。

1. エージェントが有料リソースに HTTP リクエストを送る
2. マーチャントが `HTTP 402 Payment Required` と支払いペイロード（金額・受取人・アセット・ネットワーク）を返す
3. AgentCore Payments がペイロードを受け取り、Identity からウォレット認証トークンを取得する
4. ウォレットプロバイダ経由で署名済みトランザクションを生成する
5. エージェントが `X-PAYMENT` ヘッダーに署名証明を付加してリクエストをリトライする
6. マーチャントが支払いを検証し、コンテンツを配信する

決済速度は2秒未満、トランザクションコストは約 $0.0001 のオーダーと報告されている。USDC ステーブルコインを使用することで、従来のクレジットカード決済では経済的に成り立たないマイクロ決済（$0.01 未満）が可能になる。

---

## 8. オブザーバビリティ

### 8.1 CloudWatch メトリクス（主要なもの）

| メトリクス | 説明 |
|---|---|
| `PaymentSuccessCount` | 成功したトランザクション数 |
| `PaymentFailureCount` | 失敗したトランザクション数 |
| `PaymentLatency` | 決済処理レイテンシ（ミリ秒） |
| `SpendAmount` | 処理された決済金額 |
| `ActiveSessions` | アクティブな PaymentSession 数 |
| `OperationLatency` | API 呼び出しのエンドツーエンドレイテンシ |

### 8.2 X-Ray スパン

データプレーン API 呼び出しごとに `Bedrock.AgentCore.Payments.<Operation>` 形式のスパンが発行される。`ProcessPayment` スパンには支払い金額・通貨・セッション残余予算・マーチャントアドレス・Identity からの資格情報取得レイテンシが属性として含まれる。

---

## 9. セキュリティ・コンプライアンス

### 9.1 現時点での保証

**PCI DSS への明示的な言及は公式ドキュメントおよびブログ記事に現時点では存在しない。** プレビューフェーズのため、コンプライアンス認定の詳細は GA 時に明確化される見込みである。

現時点で確認できるセキュリティ上の仕組みは以下のとおりである。

- **シークレット管理:** ウォレット秘密鍵・APIキーは AWS Secrets Manager に保管され、エージェントコードから直接アクセスできない
- **セッション分離:** 各 PaymentSession はスコープが限定されており、上限到達・有効期限切れで自動停止する
- **最小権限:** 4ロール IAM モデルにより `ProcessPayment` 呼び出し権限のみを付与可能
- **ユーザー明示承認:** エージェントがウォレットを使用するには、エンドユーザーによる事前承認が必須
- **暗号署名:** すべてのトランザクションはブロックチェーン上に監査証跡として記録される
- **Customer-Managed KMS:** Identity の Token Vault に CMK を設定することで、鍵管理を自社制御できる

### 9.2 ステーブルコインとカード情報の分離

AgentCore Payments はステーブルコイン（USDC）を決済手段とするため、クレジットカード番号などのカードホルダーデータを AgentCore 側で保持しない。カード情報は Stripe・Coinbase などのウォレットプロバイダ側が管理する。このアーキテクチャにより、開発者が直接 PCI DSS スコープに入るリスクを大幅に低減できる。

---

## 10. ユースケースと参照実装

### 10.1 公式が示す代表的なユースケース

AWS 公式ドキュメントが示すユースケースは次のとおりである。

- **Research:** 予算配分済みのリサーチエージェントが、専門データソースや有料論文にオンデマンドでアクセスして知見を提供する
- **Financial Analysis:** 金融アナリストエージェントがリアルタイム市場データやプロプライエタリデータベースの有料ウォール背後の情報にアクセスして投資分析を行う
- **Browser Agent:** ウェブサイトのボットアクセス有料化に対応し、自律的な調査・データ収集・タスク完了を実現する
- **Pay-per-Intelligence:** エージェントが最適な AI モデルに動的にタスクをルーティングし、実際のトークン使用量のみ支払う（複数モデルのサブスクリプション不要）
- **On-demand Storage:** 事前割り当て不要でオンデマンドにストレージをプロビジョニングする

### 10.2 AWS 公式サンプル実装

`aws-samples/sample-agentcore-cloudfront-x402-payments` リポジトリが公開されており、以下の3コンポーネント構成のリファレンス実装を提供している。

- **Payer（支払者）:** AgentCore Runtime 上の Strands Agents が `ProcessPayment` API 経由で自律的に支払いを実行する
- **Seller（販売者）:** CloudFront + Lambda@Edge（Node.js）が x402 ヘッダーを検証し、支払い確認後にコンテンツを配信する
- **Web UI:** React + Vite フロントエンドがリクエスト→支払い確認→コンテンツ表示の3段階フローをガイドする

---

## 11. slidev-agent プロジェクトへの適用可能性

本プロジェクト（slidev-agent）は AgentCore Runtime + Amplify Hosted Next.js Web UI で動作するスライド自動生成エージェントである。これをサブスク型 SaaS として提供するうえでの判断材料を以下に整理する。

### 11.1 AgentCore Payments が現時点でカバーできる用途

AgentCore Payments は「エージェントがサービスを購入する」方向（B2B / Agent-to-Merchant）に最適化されている。具体的には、スライド生成の過程でエージェントが有料データソースや専門 API を呼び出す費用を自動精算するケースに適合する。

### 11.2 「ユーザーがサービスの利用料を支払う」SaaS サブスク課金には非対応

SaaS の文脈でより重要な「エンドユーザーが slidev-agent の月額利用料を支払う」仕組みは、AgentCore Payments のスコープ外である。この用途には従来の Stripe Subscriptions API が適切であり、以下の構成が現実的な実装パターンとなる。

**推奨アーキテクチャ（サブスク型 SaaS）:**

- **Stripe Subscriptions:** エンドユーザーの月額課金・プラン管理・Webhook によるエンタイトルメント制御
- **Amazon Cognito + AgentCore Identity:** ユーザー認証とエージェントへの認証委任
- **AgentCore Runtime:** エージェント本体のサーバーレス実行
- **AgentCore Gateway:** エージェントが利用する外部 API のツール化
- **AgentCore Memory:** ユーザーごとの生成履歴・設定の永続化
- **AgentCore Payments（将来オプション）:** エージェントが有料外部データソースを利用する際の自動精算

### 11.3 今後の動向注視ポイント

AgentCore Payments は現在プレビューであり、将来のロードマップには「エージェントがユーザーの代理でマーチャントでの購入を完了する」ブロードコマースフローが示されている。このフローが GA で提供された場合、サブスク型購入フロー自体をエージェントが担当する可能性がある。プレビュー終了のタイミングと追加機能リリースを注視することが推奨される。

---

## 参考リンク

- [AgentCore Payments 公式ドキュメント（開発者ガイド）](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments.html)
- [AgentCore Payments コアコンセプト](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-concepts.html)
- [AgentCore Payments Getting Started](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-getting-started.html)
- [AgentCore Payments オブザーバビリティ](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-observability.html)
- [AWS What's New: AgentCore Payments プレビュー発表](https://aws.amazon.com/about-aws/whats-new/2026/04/amazon-bedrock-agentcore-payments-preview/)
- [AWS ブログ: Agents that transact（Coinbase・Stripe との連携詳細）](https://aws.amazon.com/blogs/machine-learning/agents-that-transact-introducing-amazon-bedrock-agentcore-payments-built-with-coinbase-and-stripe/)
- [AWS ブログ: Visa Intelligent Commerce × AgentCore](https://aws.amazon.com/blogs/machine-learning/introducing-visa-intelligent-commerce-on-aws-enabling-agentic-commerce-with-amazon-bedrock-agentcore/)
- [AWS 産業ブログ: x402 と Agentic Commerce（金融サービス向け）](https://aws.amazon.com/blogs/industries/x402-and-agentic-commerce-redefining-autonomous-payments-in-financial-services/)
- [AgentCore Pricing（料金ページ）](https://aws.amazon.com/bedrock/agentcore/pricing/)
- [GitHub: sample-agentcore-cloudfront-x402-payments（公式サンプル）](https://github.com/aws-samples/sample-agentcore-cloudfront-x402-payments)
- [AgentCore Overview（全サービス一覧）](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html)
- [x402.org（プロトコル仕様）](https://www.x402.org/)
