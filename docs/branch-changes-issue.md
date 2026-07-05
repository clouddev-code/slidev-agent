# feat: Bedrock AgentCore Runtime + Amplify Gen 2 ホスト型 Web UI

Branch: `feature/agentcore-amplify-deployment`
Base: `main`
Commit: `5b35091 feat: Add Bedrock AgentCore runtime and Amplify-hosted Next.js web UI`

## 概要

Slidev Agent を **Bedrock AgentCore Runtime にデプロイ可能なマルチエージェント (Strands Graph) 構成** に拡張し、それを呼び出す **AWS Amplify Gen 2 (Next.js 14 App Router)** の Web UI を追加しました。インフラは **AWS CDK** で `@aws-cdk/aws-bedrock-agentcore-alpha` の L2 Construct を用いて IaC 化しています。

### アーキテクチャ要約

```
[ Next.js (Amplify Hosting) ]
        │
        │  GraphQL mutation
        ▼
[ AppSync (Amplify Data) ] ──► [ DynamoDB SlideJob ]
                                       │ Streams
                                       ▼
                          [ Lambda: generate-slides ]
                                       │
                                       │  InvokeAgentRuntime (SSE)
                                       ▼
                       [ Bedrock AgentCore Runtime ]
                                       │
              planner → researcher → writer → validator
                                                │
                                                └─[needs_revision]→ writer
                                       │
                                       ▼
                                  [ S3 (slides.md) ]
```

## 主な変更内容

### 1. マルチエージェント Strands Graph (`src/slidev_agent/agent.py`)
- 単一エージェント (CLI) と並行して、**4 ロールの Strands `GraphBuilder` 構成** を導入
  - `planner` … 構成案を作る (tool 不要)
  - `researcher` … `web_search` / `web_extract` で情報収集
  - `writer` … `write_slidev_markdown` で `.md` / S3 へ書き出し
  - `validator` … `validate_slides_fit` で枠内検証、`approved` / `revision needed` を出力
- `validator → writer` のフィードバックループ (`_needs_revision` で条件分岐)

### 2. AgentCore Runtime ハンドラ (`src/slidev_agent/runtime.py`)
- BedrockAgentCore Python SDK の `@app.entrypoint` でグラフを SSE ストリーミング起動
- `multiagent_node_stream` イベントから Lambda 側へノード進捗を中継
- セッション ID は AgentCore 規定の `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id` を尊重

### 3. ツール拡張
- `tools/writer.py` … ローカル / S3 両対応のスライド書き出し
- `tools/validator.py` … スライドのオーバーフロー検証ロジック追加

### 4. CDK インフラ (`infra/`)
- `slidev-agent-runtime-stack.ts` … AgentCore Runtime, IAM Role, Secrets Manager 参照, S3 バケット, CloudWatch LogRetention
- `@aws-cdk/aws-bedrock-agentcore-alpha` L2 を使用
- Tavily API Key は Secrets Manager から runtime 内で取得

### 5. Amplify Gen 2 バックエンド (`web/amplify/`)
- `auth/resource.ts` … Cognito User Pool + Identity Pool
- `data/resource.ts` … AppSync GraphQL + DynamoDB SlideJob モデル (`allow.owner`)
- `storage/resource.ts` … S3 `jobs/{entity_id}/*` (Identity Pool 認可)
- `functions/generate-slides/` … DynamoDB Streams トリガの Lambda
- `backend.ts` … Streams / AppSync / AgentCore InvokeAgentRuntime の IAM 接続

### 6. Next.js 14 App Router フロントエンド (`web/app/`, `web/components/`)
- `signin` / `generate` / `dashboard` / `jobs/[id]` ページ
- `SlideForm`, `JobProgress`, `SlidevPreview`, `Nav` コンポーネント
- `observeQuery` でジョブステータスをリアルタイム購読

### 7. デプロイ周辺
- `Dockerfile` (linux/arm64), `.dockerignore`
- `amplify.yml` (monorepo の `web/` を Amplify Hosting でビルド)

## 変更ファイル統計

```
39 files changed, 2835 insertions(+), 269 deletions(-)
```

主要追加: `infra/` (CDK), `web/` (Amplify + Next.js), `Dockerfile`, `amplify.yml`
主要変更: `src/slidev_agent/{agent,runtime,tools/writer,tools/validator}.py`, `pyproject.toml`

## 既知の課題 (要対応)

3 名 (CDK / バックエンド / フロントエンド) 並列レビューで検出済み。詳細は [`docs/team-review-amplify-agentcore.md`](docs/team-review-amplify-agentcore.md)。

### Critical (本番ブロッカー)

| # | 領域 | 内容 |
| --- | --- | --- |
| A | IaC / FE / BE | **Storage 認可ルール `jobs/{entity_id}/*` (Cognito Identity ID) と Lambda が書く `jobs/${ULID}/slides.md` の不整合** — 正規ユーザーが自分のスライドをダウンロードしようとしても `AccessDenied` |
| B | Frontend | `web/app/signin/page.tsx` の `Authenticator` render-prop callback 内で `useEffect` を呼ぶ **Rules of Hooks 違反** |
| C | Backend | `agent.py:_writer_invocation_state()` の戻り値が未使用。Writer が `invocation_state` 経由で `output_path` (S3 URI) を受け取れていない |
| D | Backend / IaC | Bedrock cross-region inference profile ID `us.anthropic.claude-opus-4-6-v1` に **version suffix `:0` が欠落**。`ValidationException` で起動時に全失敗 |

### High (リリース前対応)

- `bedrock:InvokeModel` / DDB Streams ポリシーの `resources: ['*']` を ARN で絞り込み
- 同期 SSE 5〜15 分処理を 900s Lambda で受ける構造 → SQS / Step Functions Express への分解
- `Amplify.configure()` の 2 重実行 → `ConfigureAmplifyClientSide` パターンへ統一
- `web/package.json` のバックエンド依存 (`@aws-sdk/*`, `aws-cdk-lib` 等) を `devDependencies` に
- `multiagent_node_stream` で `current_tool_use` (toolUse / toolResult) を取りこぼし
- `reset_on_revisit(True)` で validator 指摘を writer が忘れる
- `_needs_revision` の文字列部分一致 → 日本語出力時に暗黙承認
- Dockerfile の `uv sync` フォールバックで venv パスがズレる

## 関連ドキュメント

- 仕様: [`docs/agentcore-amplify-deployment-spec.md`](docs/agentcore-amplify-deployment-spec.md)
- 実装レポート: [`docs/IMPLEMENTATION_REPORT.md`](docs/IMPLEMENTATION_REPORT.md)
- 3 観点並列レビュー: [`docs/team-review-amplify-agentcore.md`](docs/team-review-amplify-agentcore.md)

## チェックリスト

- [ ] Critical-A: SlideJob に `identityId` 追加 + S3 キーを `jobs/${identityId}/${job.id}/slides.md` に
- [ ] Critical-B: `signin/page.tsx` の `useEffect` を別 Component に分離
- [ ] Critical-C: `stream_async(invocation_state=...)` を渡し、ツールを `@tool(context=True)` 化
- [ ] Critical-D: `bedrockModelId` に `:0` suffix 付与
- [ ] High 各項目への対応
- [ ] Bedrock AgentCore Runtime への実デプロイ検証
- [ ] Amplify Hosting への実デプロイ検証
