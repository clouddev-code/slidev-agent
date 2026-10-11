# Bedrock Opus 4.6 から Claude Platform の Claude Sonnet 5.5（WIF）への切り替え

参考: https://github.com/clouddev-code/agentcore-claude-wif-aws

## 概要

AgentCore Runtime で動くエージェント（planner → researcher → writer → validator）が使うモデルを、Bedrock の `us.anthropic.claude-opus-4-6-v1:0` から Claude Platform（Claude API）の `claude-sonnet-5-5` に切り替えました。

- 認証は Workload Identity Federation（WIF）を使います。API キーは使いません
- Runtime の実行ロールで STS `GetWebIdentityToken` を呼び、AWS が署名した OIDC トークンを Claude API のアクセストークンに交換します。交換は SDK が自動で行います
- Strands の `AnthropicModel` に `client_args={"credentials": WorkloadIdentityCredentials(...)}` を渡します
- Bedrock と Vertex AI の経路も残しているので、`MODEL_PROVIDER=bedrock` / `vertexai` に切り替えれば従来の動作になります

## 変更内容

| ファイル | 変更 |
|---|---|
| `pyproject.toml` / `uv.lock` | `anthropic>=1.11.0` を追加（解決結果は 1.11.0） |
| `src/slidev_agent/agent.py` | `create_model` に `anthropic` プロバイダを追加し、既定にした。`ANTHROPIC_FEDERATION_RULE_ID` があれば WIF を使い、なければ `ANTHROPIC_API_KEY` で動く（ローカル開発用）。`AnthropicModel` はプロセスで 1 つだけ作り（`lru_cache`）、リクエスト間で使い回す。アクセストークンのキャッシュ（`_token_cache`）は `AsyncAnthropic` クライアントが持っているので、モデルを毎回作るとジョブのたびに STS 呼び出しとトークン交換が発生してしまう |
| `infra/lib/slidev-agent-runtime-stack.ts` | `modelProvider` で処理を分けた。`anthropic` の場合は WIF 用の環境変数 5 つを設定し、`sts:GetWebIdentityToken` の権限を付け、実行ロール名を固定する。`bedrock` の場合は従来どおり `InvokeModel` の権限を付ける |
| `infra/bin/slidev-agent-infra.ts` | context の `modelProvider`（既定は `anthropic`）、`anthropicModelId`、`executionRoleName` と WIF の ID 4 つを読む。未設定のときや `REPLACE_ME` が残っているときは synth の時点でエラーにする |
| `infra/cdk.json` | `executionRoleName: SlidevAgentRuntimeRole` を追加。`app` を `ts-node` から `tsx` に変更 |
| `infra/package.json` | devDependencies の `ts-node` を `tsx` 4.23.0 に置き換え（`npm install` はまだ実行していない） |
| `infra/cdk.context.example.json` | 新規。WIF の ID 4 つのひな形（`cdk.context.json` は gitignore 済み） |
| `.env.example` / `docs/README.md` / `infra/README.md` | 新しい環境変数と手順を追記 |

### 既存の不具合のうち、今回直したもの

- `infra/lib/slidev-agent-runtime-stack.ts` は `@aws-cdk/aws-bedrock-agentcore-alpha` を import していましたが、このパッケージは `package.json` にも `node_modules` にもなく、コンパイルが通らない状態でした。インストール済みの aws-cdk-lib 2.266.0 に含まれる安定版の `aws-cdk-lib/aws-bedrockagentcore` に置き換えました（API は同じ）
- TypeScript 7 では `@types/node` が自動で読み込まれないため、`process` や `__dirname` で型エラーになっていました。`infra/tsconfig.json` に `"types": ["node"]` を追加しました
- `cdk.json` の `app` で使っていた ts-node 10.9.2 は TypeScript 7 では `TypeError: Cannot read properties of undefined (reading 'fileExists')` で起動せず、`cdk synth` / `cdk deploy` が必ず失敗していました。参考リポジトリと同じく `tsx` に置き換えました

### Python SDK のバージョンについて

参考リポジトリは `anthropic>=1.12.1` を使っていますが、このリポジトリは `[tool.uv] exclude-newer = "7 days"` が設定されており、2026-10-11 の時点では 1.11.0（2026-09-30 リリース）までしか解決できません。1.11.0 にも `WorkloadIdentityCredentials`（引数は同じ）と `AsyncAnthropic(credentials=...)` があることを確認したので、下限を `>=1.11.0` にしました。strands-agents 1.57.1 の `AnthropicModel` も `anthropic.AsyncAnthropic(**client_args)` をそのまま呼ぶので、`credentials` を渡せます。

## セットアップ手順

### 1. AWS: Outbound web identity federation を有効化する（アカウントごとに 1 回）

```fish
python3 -c "import boto3; boto3.client('iam').enable_outbound_web_identity_federation()"
python3 -c "import boto3; print(boto3.client('iam').get_outbound_web_identity_federation_info())"
```

2 行目で表示される Issuer URL（`https://<uuid>.tokens.sts.global.api.aws`）を控えておきます。

### 2. Claude Console: Workload identity を登録する

Settings → Workload identity → Connect workload → AWS で登録します。

- Federation issuer: 手順 1 の Issuer URL（`jwks: discovery`）
- Federation rule:
  - `match.subject_prefix`: `arn:aws:iam::<account>:role/SlidevAgentRuntimeRole`（末尾に `*` は付けない）
  - `match.audience`: `https://api.anthropic.com`
  - `target`: service account、workspace、`oauth_scope: workspace:developer`
- 登録後に表示される `fdrl_...` / `svac_...` / `wrkspc_...` と organization ID を控えます

ロール名を変える場合は、`infra/cdk.json` の `executionRoleName` も同じ名前にしてください。

### 3. `infra/cdk.context.json` に ID を書く

```fish
cd infra
cp cdk.context.example.json cdk.context.json
# REPLACE_ME を手順 2 で控えた値に置き換える
```

これらの値は `cdk.json` には書かないでください。`cdk.json` の context は `cdk.context.json` より優先されます。これらは ID で、秘密情報ではありません。

### 4. デプロイ（ご自身で実行してください）

```fish
cd infra
nvm use 22.23.2
npm install   # ts-node を tsx に置き換えたので必ず実行する
npx tsc --noEmit -p .
npx cdk diff
npx cdk deploy
```

デプロイ後、出力の `AgentRuntimeRoleArn` が手順 2 で登録した ARN と同じであることを確認してください。

### 5. 動作確認

```fish
set -x AGENT_RUNTIME_ARN (aws cloudformation describe-stacks --stack-name SlidevAgentRuntimeStack --query "Stacks[0].Outputs[?OutputKey=='AgentRuntimeArn'].OutputValue" --output text)
aws bedrock-agentcore invoke-agent-runtime --agent-runtime-arn $AGENT_RUNTIME_ARN --runtime-session-id (uuidgen)-(uuidgen) --payload '{"topic":"Amazon Bedrock AgentCore の概要","num_slides":5}' --cli-binary-format raw-in-base64-out response.json
cat response.json
```

401 `Authentication failed` が返った場合は、Claude Console の Workload identity → History で拒否された理由を確認します。原因の多くは、Issuer URL の不一致か、ルールに登録したロール ARN の不一致です。

## ローカル開発

ローカルの認証情報はフェデレーションルールの subject（実行ロール ARN）と一致しないため、WIF は使えません。ローカルでは `.env` に `ANTHROPIC_API_KEY` を書けば、同じ `claude-sonnet-5-5` で動きます（`ANTHROPIC_FEDERATION_RULE_ID` を設定しなければ API キーが使われます）。

```fish
set -x ANTHROPIC_API_KEY sk-ant-...
uv run slidev-agent "Amazon Bedrock AgentCore の概要"
```

## 注意点

- **実行ロールの置き換え**: `executionRoleName` で実行ロール名を固定したため、デプロイ済みのスタックを更新すると IAM ロールが作り直されます（CloudFormation の置き換え）。Claude Console に先にルールを登録しておけば、デプロイは 1 回で済みます
- **外向き通信**: Runtime から `api.anthropic.com` に HTTPS で接続できる必要があります。今の PUBLIC ネットワークモードなら問題ありません。VPC モードに変える場合は NAT Gateway などのインターネット経路が必要です
- **課金と利用制限**: Bedrock ではなく Claude Platform の組織・ワークスペース側で管理されます。`anthropic` モードの実行ロールには Bedrock の `InvokeModel` 権限を付けていません
- **`sub` の照合**: STS トークンの `sub` は実行ロールの ARN です。追加の防御策として、Console のルールで `aws_account` クレームも照合することをおすすめします

## 検証結果（2026-10-11）

| 項目 | 結果 |
|---|---|
| `uv add anthropic>=1.11.0` | anthropic 1.11.0 で解決。strands-agents は 1.57.1 のまま |
| モデルの生成（ダミーの WIF ID） | `create_model()` が `AnthropicModel`（`claude-sonnet-5-5`）を返し、`create_slidev_graph()` で 4 ノードのグラフを組み立てられた。2 回目以降の `create_model()` は同じインスタンス（`credentials` と `_token_cache` を持つクライアント）を返すことを確認 |
| API キーへのフォールバック | `ANTHROPIC_API_KEY` だけを設定した場合も `AnthropicModel` が作られる。`create_model('bedrock')` は従来どおり `BedrockModel` を返す |
| `pytest` | 17 件成功、2 件失敗。失敗した `test_write_basic_markdown` と `test_write_creates_directory` は変更前から失敗しており、今回の変更とは関係ない |
| `ruff check src` | 4 件。いずれも変更前からある指摘（`agent.py` の import 順を含む）で、件数は変わっていない |
| `npx tsc --noEmit -p .`（infra） | 成功 |
| `cdk synth` | このセッションでは実行していない（未検証）。tsx への切り替え後の `cdk synth` も未確認 |
| 実際の API 呼び出し | 未実施 |

## 未対応の既存の問題（デプロイ前に確認が必要）

- **`Dockerfile`**: `COPY pyproject.toml uv.lock* README.md ./` でルートの `README.md` をコピーしていますが、ルートには `README.md` がありません（`docs/README.md` のみ）。また、`uv sync` は `/app/.venv` にパッケージを入れますが、runtime ステージは `/usr/local/lib/python3.13` しかコピーしていません。このままだとイメージのビルドに失敗するか、依存パッケージが入らない可能性があります
