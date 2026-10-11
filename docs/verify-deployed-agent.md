# デプロイ済み AgentCore Runtime の動作確認

## 前提: ローカルのフロントと Runtime は通信形式が違う

| 項目 | web/ (Next.js + CopilotKit) | デプロイ済み Runtime |
|---|---|---|
| エントリポイント | `HttpAgent` → `AGENT_URL` (既定 `http://localhost:8000/`) | `slidev_agent.runtime` (`BedrockAgentCoreApp`) |
| プロトコル | AG-UI (`ag_ui_strands`) | AgentCore `InvokeAgentRuntime` (SigV4 必須) |
| イベント形式 | AG-UI イベント | 独自 SSE (`node_start` / `node_text` / `node_done` / `result` / `error`) |

`web/app/api/copilotkit/route.ts` は、`AGENT_RUNTIME_ARN` があれば Runtime への中継（`web/lib/agentcore-agent.ts`）を使い、無ければ `AGENT_URL` のローカル `agui_server` に繋ぐ。

## 1. Runtime を CLI で直接呼ぶ（今すぐ可能）

```fish
set -x RUNTIME_ARN (aws ssm get-parameter --name /slidev-agent/agent-runtime-arn --query Parameter.Value --output text)
aws bedrock-agentcore invoke-agent-runtime \
  --agent-runtime-arn $RUNTIME_ARN \
  --runtime-session-id (uuidgen) \
  --content-type application/json \
  --accept text/event-stream \
  --cli-binary-format raw-in-base64-out \
  --payload '{"topic":"AWS CDK 入門","num_slides":5,"language":"ja"}' \
  out.txt
cat out.txt
```

- スライドは `s3://<SlidesBucketName>/jobs/<session-id>/slides.md` に出力される（バケットはスタックが作成。出力 `SlidesBucketName`）。

```fish
set -x BUCKET (aws cloudformation describe-stacks --stack-name SlidevAgentRuntimeStack --query "Stacks[0].Outputs[?OutputKey=='SlidesBucketName'].OutputValue" --output text)
aws s3 ls s3://$BUCKET/jobs/ --recursive
```

ログ:

```fish
set -x RUNTIME_ID (aws cloudformation describe-stacks --stack-name SlidevAgentRuntimeStack --query "Stacks[0].Outputs[?OutputKey=='AgentRuntimeId'].OutputValue" --output text)
aws logs tail "/aws/bedrock-agentcore/runtimes/$RUNTIME_ID-DEFAULT" --follow
```

## 2. フロントで確認する（ローカルの AG-UI サーバー経由、Runtime は使わない）

```fish
# ターミナル1: AG-UI サーバー (要: ローカルのモデル認証情報 / Tavily キー)
uv run uvicorn slidev_agent.agui_server:app --reload --port 8000

# ターミナル2: フロント
cd web; and cp .env.example .env.local; and npm run dev
# → http://localhost:3000
```

## 3. デプロイしたフロントで確認する

`npx cdk deploy --all` で `SlidevAgentFrontendStack` をデプロイし、Cognito ユーザーを作成してから出力 `WebUrl` を開く（手順は infra/README.md の Frontend 節）。
