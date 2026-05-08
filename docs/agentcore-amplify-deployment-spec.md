# Slidev Agent — AgentCore Runtime + Amplify Gen 2 デプロイ仕様書

> 対象: 既存の Strands Agents 実装 (`slidev_agent`) を Amazon Bedrock AgentCore Runtime にデプロイし、Web フロントエンドを AWS Amplify Gen 2 でホスティングして、自然言語からスライド生成できる SaaS 形態にする。
>
> 作成日: 2026-05-07 / バージョン: 0.1 (設計案)

---

## 1. ゴールとスコープ

### 1.1 ゴール

| # | ゴール | 達成条件 |
|---|--------|---------|
| G1 | 既存 CLI 相当のスライド生成エージェントをマネージドな HTTP エンドポイントとして提供する | AgentCore Runtime にデプロイし、`InvokeAgentRuntime` 経由で起動できる |
| G2 | 認証付きの Web UI からトピックを入力するだけでスライドを生成・閲覧・ダウンロードできる | Amplify Gen 2 (Cognito + Next.js) で `/generate` から起動 → `/jobs/{id}` で結果取得 |
| G3 | 生成中の進捗（Tool 呼び出し・反復試行）をリアルタイム表示する | SSE / AppSync Subscription による段階的レスポンス |
| G4 | 生成成果物 (`slides.md`) を永続化し、再表示・PDF エクスポート・履歴管理ができる | S3 + DynamoDB / AppSync で履歴管理 |
| G5 | 認証・IAM・Secrets を最小権限で運用する | Cognito JWT、Secrets Manager、Service Role 分離 |

### 1.2 非スコープ（今回扱わない）

- Slidev のフルレンダリング（presenter mode、`@slidev/cli` 起動）→ MVP では Markdown 表示と zip 形式の export 配布のみ
- マルチテナント請求基盤
- カスタムドメイン (将来オプション)
- リアルタイム共同編集

---

## 2. アーキテクチャ概要

### 2.1 全体図

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              ユーザー (ブラウザ)                              │
└────────────────────┬────────────────────────────────────────────────────────┘
                     │ HTTPS (Cognito JWT)
                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Amplify Hosting (WEB_COMPUTE: Next.js 14+ App Router)                       │
│   - /generate (フォーム), /jobs/[id] (詳細), /dashboard (履歴)                │
│   - aws-amplify/* SDK で Auth / Data / Storage を呼び出し                    │
└────────────────────┬────────────────────────────────────────────────────────┘
                     │ GraphQL (AppSync) / REST (API GW)
                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Amplify Gen 2 Backend (CDK 内部)                         │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────┐  ┌─────────────┐  │
│  │ Auth         │  │ Data (AppSync)   │  │ Storage (S3) │  │ Functions   │  │
│  │ Cognito UP   │  │ - SlideJob       │  │ slides/${id}/│  │ (Lambda)    │  │
│  │ ID Pool      │  │ - subscription   │  │   slides.md  │  │ generate-   │  │
│  └──────────────┘  └──────────────────┘  └──────────────┘  │ slides      │  │
│                                                            └──────┬──────┘  │
└───────────────────────────────────────────────────────────────────│─────────┘
                                                                    │ SigV4
                                                                    │ InvokeAgentRuntime
                                                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│               Amazon Bedrock AgentCore Runtime (slidev-agent)                 │
│                                                                             │
│  BedrockAgentCoreApp  (Strands Agent: Claude Opus 4.6 / Gemini 3.1 Pro)     │
│                                                                             │
│   tools: web_search, web_extract, write_slidev_markdown(→S3),               │
│          validate_slides_fit                                                │
│                                                                             │
│   生成 .md は S3 (Amplify Storage バケット) に直接書き込み                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                                  │
                                                  ▼
                                    ┌──────────────────────┐
                                    │ Tavily API / Bedrock │
                                    │ Secrets Manager      │
                                    └──────────────────────┘
```

### 2.2 主要シーケンス（同期 + 進捗ストリーミング）

```
User    Frontend       AppSync         Lambda          AgentCore       S3
 │         │              │              │                │            │
 │ submit  │              │              │                │            │
 │────────▶│              │              │                │            │
 │         │ createJob    │              │                │            │
 │         │─────────────▶│ insert JOB   │                │            │
 │         │              │ (PENDING)    │                │            │
 │         │              │ → trigger ──▶│                │            │
 │         │ subscribe    │              │                │            │
 │         │─────────────▶│              │ Invoke         │            │
 │         │              │              │───────────────▶│            │
 │         │              │              │ SSE chunks     │            │
 │         │              │              │ ◀──────────────│            │
 │         │              │              │ updateJob      │            │
 │         │              │              │ (RUNNING+log)  │ write s3   │
 │         │              │◀─────────────│                │───────────▶│
 │         │ subscription │              │                │            │
 │         │ event        │              │                │            │
 │ ◀───────│              │              │                │            │
 │         │              │              │ updateJob      │            │
 │         │              │              │ (DONE,s3Url)   │            │
 │         │              │◀─────────────│                │            │
 │ render  │              │              │                │            │
 │ preview │              │              │                │            │
```

ポイント:
- フロントは AppSync `Subscription onUpdateSlideJob(id)` で進捗を受け取る (WebSocket 維持はせず JOB ID のみで購読)
- Lambda は AgentCore のレスポンス SSE を解釈して、AppSync mutation で `JobLog` を逐次追記
- 完了時に `status=DONE` と `s3Key` を埋める

---

## 3. AgentCore Runtime 側の設計

### 3.1 採用する SDK / フレームワーク

| 項目 | 選定 | 理由 |
|------|------|------|
| SDK | `bedrock-agentcore` (`BedrockAgentCoreApp`) | 公式推奨。`/invocations`, `/ping` を自動実装、JWT/IAM 認証ヘッダーを `context` で透過取得 |
| デプロイツール | `bedrock-agentcore-starter-toolkit` (`agentcore` CLI) | `agentcore configure` → `agentcore launch` で ECR ビルド + `CreateAgentRuntime` まで自動 |
| エージェント | Strands Agents (現状の `slidev_agent.agent`) | 変更不要。`stream_async` で逐次イベントを yield |
| LLM | Bedrock (Claude Opus 4.6) を主、Vertex AI Gemini をオプション | 既存 `MODEL_PROVIDER` 切替を維持 |
| コンテナ | `linux/arm64`, Python 3.13, ポート 8080 | 公式推奨、Graviton で実行 |

### 3.2 既存コードからの差分

| ファイル | 現状 | 変更点 |
|---------|------|--------|
| `src/slidev_agent/runtime.py` | 自作の `handler(event, context)` | `BedrockAgentCoreApp().entrypoint` でラップした async 関数に書き換え。`stream_async` の events を `yield` してストリーミングレスポンス化 |
| `src/slidev_agent/tools/writer.py` | ローカル `./output/slides.md` に書き込み | **S3 書き込みに変更**。`S3_BUCKET` / `S3_KEY_PREFIX` env で指定。`output_path` は `s3://bucket/key` を返す |
| `agentcore.yaml` | 自作の独自フォーマット | `agentcore configure` が生成する `.bedrock_agentcore.yaml` に置き換え (Starter Toolkit 標準) |
| `pyproject.toml` | `bedrock-agentcore` 依存なし | `bedrock-agentcore`, `bedrock-agentcore-starter-toolkit` を追加 |
| `Dockerfile` | なし | `agentcore configure` が雛形生成。`uv` を使ったマルチステージ ARM64 ビルド |
| `.dockerignore` | なし | `output/`, `node_modules/`, `.venv/`, `tests/` を除外 |

### 3.3 新しい `runtime.py` の骨子

```python
# src/slidev_agent/runtime.py
import os
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from .agent import create_slidev_agent, SlidevAgentConfig, build_user_prompt

app = BedrockAgentCoreApp()
_agent = None

def get_agent():
    global _agent
    if _agent is None:
        _agent = create_slidev_agent()
    return _agent

@app.entrypoint
async def invoke(payload: dict, context):
    """AgentCore entrypoint. payload は JSON dict。

    payload schema:
      topic: str                  (required)
      num_slides, style, theme, language: 既存と同じ
      job_id: str                 (Amplify から渡す。S3 prefix にも使う)
    """
    job_id = payload.get("job_id") or context.session_id
    config = SlidevAgentConfig(
        topic=payload["topic"],
        num_slides=payload.get("num_slides", 10),
        style=payload.get("style", "technical"),
        theme=payload.get("theme", "penguin"),
        language=payload.get("language", "ja"),
        # output_path は S3 URI 化
        output_path=f"s3://{os.environ['SLIDES_BUCKET']}/jobs/{job_id}/slides.md",
    )
    prompt = build_user_prompt(config)
    agent = get_agent()

    async for event in agent.stream_async(prompt):
        # event は Strands のテキストデルタ / ToolUse / ToolResult
        yield event  # AgentCore が SSE に変換

if __name__ == "__main__":
    app.run()
```

### 3.4 Tool の S3 化（`writer.py`）

```python
# 抜粋
import boto3
from urllib.parse import urlparse

@tool
def write_slidev_markdown(slides_content: str, output_path: str = ..., theme: str = ...):
    full_content = _build_frontmatter(theme, title) + slides_content.lstrip()
    if output_path.startswith("s3://"):
        u = urlparse(output_path)
        boto3.client("s3").put_object(
            Bucket=u.netloc,
            Key=u.path.lstrip("/"),
            Body=full_content.encode("utf-8"),
            ContentType="text/markdown; charset=utf-8",
        )
        return {"success": True, "path": output_path, "bytes": len(full_content)}
    # フォールバック: ローカル (CLI 利用時)
    Path(output_path).write_text(full_content, encoding="utf-8")
    ...
```

`validate_slides_fit` も `s3://` を読めるように対応する（`boto3.client("s3").get_object`）。

### 3.5 AgentCore 認証方式の選定

候補:

| 方式 | メリット | デメリット | 採用 |
|------|----------|------------|------|
| **A. IAM SigV4 (デフォルト)** | Lambda Execution Role に `bedrock-agentcore:InvokeAgentRuntime` を付与すれば boto3 で即呼び出せる | フロントエンドから直接は呼べず、必ず Lambda 経由 | ✅ **採用** |
| B. JWT Inbound Authorizer (Cognito) | フロントエンドから直接呼べる、ユーザー識別子をエージェントに伝播 | SigV4 と排他。boto3 が使えず、自前で HTTPS POST が必要 | ❌（運用簡素化のため不採用） |

**結論**: IAM SigV4 + Lambda 経由 (前述 案A) を採用。Lambda 内で Cognito JWT を検証し、ユーザー ID を `payload.user_id` として AgentCore に渡す。

### 3.6 セッション管理

- `runtimeSessionId`: `${jobId}` を 33 文字以上にパディング (e.g. `slidev-${uuid()}` で 40 文字以上)
- 1 ジョブ = 1 セッション。基本的に 1 度しか呼ばないので microVM 共有は不要
- アイドルタイムアウト: 30 分（デフォルト 15 分から拡大）に設定。生成失敗時のリトライ猶予を確保

### 3.7 IAM 実行ロール

AgentCore Runtime の Execution Role に必要な権限:

```json
{
  "Statement": [
    { "Effect": "Allow", "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ], "Resource": "*" },
    { "Effect": "Allow", "Action": [
        "secretsmanager:GetSecretValue"
      ], "Resource": "arn:aws:secretsmanager:*:*:secret:slidev-agent/TAVILY_API_KEY*" },
    { "Effect": "Allow", "Action": [
        "s3:PutObject", "s3:GetObject"
      ], "Resource": "arn:aws:s3:::${SLIDES_BUCKET}/jobs/*" },
    { "Effect": "Allow", "Action": [
        "logs:CreateLogStream", "logs:PutLogEvents"
      ], "Resource": "arn:aws:logs:*:*:log-group:/aws/bedrock-agentcore/*" }
  ]
}
```

### 3.8 環境変数

| 変数 | 用途 | 例 |
|------|------|------|
| `SLIDES_BUCKET` | 出力先 S3 バケット (Amplify Storage が作るバケット名) | `amplify-slidev-...-slidesbucket` |
| `MODEL_PROVIDER` | `bedrock` or `vertexai` | `bedrock` |
| `BEDROCK_MODEL_ID` | Claude モデル | `us.anthropic.claude-opus-4-6-v1` |
| `AWS_REGION` | リージョン | `us-east-1` |
| `TAVILY_API_KEY` | 検索 API | Secrets Manager 参照 (`{{secret}}`) |

---

## 4. Amplify Gen 2 側の設計

### 4.1 ディレクトリ構成 (リポジトリ)

```
slidev-agent/                              # 既存 Python リポジトリ
├── src/slidev_agent/                      # AgentCore 用 Python
├── .bedrock_agentcore.yaml                # AgentCore Starter Toolkit が生成
├── Dockerfile                             # 同上
└── web/                                   # ★ 新規追加: Amplify Gen 2 アプリ
    ├── package.json
    ├── amplify.yml                        # Amplify Hosting ビルドスペック
    ├── amplify/
    │   ├── backend.ts                     # 全体 backend 定義
    │   ├── auth/resource.ts               # Cognito User Pool
    │   ├── data/resource.ts               # AppSync schema
    │   ├── storage/resource.ts            # S3 (slides bucket)
    │   └── functions/
    │       └── generate-slides/
    │           ├── resource.ts            # Lambda 定義
    │           └── handler.ts             # Lambda 実装
    ├── app/                               # Next.js App Router
    │   ├── layout.tsx
    │   ├── page.tsx                       # ランディング
    │   ├── (auth)/signin/page.tsx
    │   ├── generate/page.tsx              # フォーム
    │   ├── jobs/[id]/page.tsx             # 詳細・進捗
    │   └── dashboard/page.tsx             # 履歴
    └── components/
        ├── SlideForm.tsx
        ├── JobProgress.tsx
        └── SlidevPreview.tsx
```

リポジトリ構成は **monorepo 1 つ**。Amplify Hosting で `AMPLIFY_MONOREPO_APP_ROOT=web` を指定して、フロントエンド側だけビルドする。

### 4.2 Amplify Gen 2 backend 定義

#### 4.2.1 `amplify/backend.ts`

```typescript
import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';
import { generateSlides } from './functions/generate-slides/resource';
import * as iam from 'aws-cdk-lib/aws-iam';

const backend = defineBackend({ auth, data, storage, generateSlides });

// Lambda → AgentCore Runtime 呼び出し権限
const agentRuntimeArn = process.env.AGENT_RUNTIME_ARN!;  // CI 環境変数で渡す
backend.generateSlides.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['bedrock-agentcore:InvokeAgentRuntime'],
    resources: [`${agentRuntimeArn}*`],
  })
);

// Lambda が AppSync mutation を発火できるように
backend.generateSlides.resources.lambda.addEnvironment(
  'APPSYNC_API_URL', backend.data.resources.cfnResources.cfnGraphqlApi.attrGraphQlUrl
);
backend.generateSlides.resources.lambda.addEnvironment(
  'SLIDES_BUCKET', backend.storage.resources.bucket.bucketName
);
```

#### 4.2.2 `amplify/auth/resource.ts`

```typescript
import { defineAuth } from '@aws-amplify/backend';

export const auth = defineAuth({
  loginWith: { email: true },
  // メール検証コードでサインアップ
});
```

#### 4.2.3 `amplify/data/resource.ts`

```typescript
import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

const schema = a.schema({
  SlideJob: a
    .model({
      id: a.id().required(),
      owner: a.string(),
      topic: a.string().required(),
      numSlides: a.integer().default(10),
      style: a.enum(['technical', 'business', 'educational', 'pitch']),
      theme: a.string().default('penguin'),
      language: a.string().default('ja'),
      status: a.enum(['PENDING', 'RUNNING', 'DONE', 'FAILED']),
      s3Key: a.string(),
      logs: a.string().array(),       // 進捗ログ (Tool 呼び出し履歴)
      errorMessage: a.string(),
      createdAt: a.datetime(),
      updatedAt: a.datetime(),
    })
    .authorization(allow => [allow.owner()]),  // 所有者のみアクセス
});

export type Schema = ClientSchema<typeof schema>;
export const data = defineData({
  schema,
  authorizationModes: { defaultAuthorizationMode: 'userPool' },
});
```

#### 4.2.4 `amplify/storage/resource.ts`

```typescript
import { defineStorage } from '@aws-amplify/backend';

export const storage = defineStorage({
  name: 'slidesBucket',
  access: (allow) => ({
    'jobs/{entity_id}/*': [
      allow.entity('identity').to(['read']),                    // 所有者は読み取り可
      allow.resource(generateSlides).to(['read', 'write']),    // Lambda は読み書き
    ],
  }),
});
```

> 注意: AgentCore Runtime の Execution Role は **Amplify 管理外** なので、`backend.storage.resources.bucket.grantPut(...)` を `iam.Role.fromRoleArn(...)` で参照して付与する。

#### 4.2.5 `amplify/functions/generate-slides/resource.ts`

```typescript
import { defineFunction } from '@aws-amplify/backend';

export const generateSlides = defineFunction({
  name: 'generate-slides',
  entry: './handler.ts',
  timeoutSeconds: 900,                  // 15 min (Lambda 上限)
  memoryMB: 1024,
  environment: {
    AGENT_RUNTIME_ARN: process.env.AGENT_RUNTIME_ARN ?? '',
    AWS_REGION_AGENTCORE: 'us-east-1',
  },
});
```

#### 4.2.6 `amplify/functions/generate-slides/handler.ts`

```typescript
import type { Schema } from '../../data/resource';
import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from
  '@aws-sdk/client-bedrock-agentcore';
import { generateClient } from 'aws-amplify/data';
import { Amplify } from 'aws-amplify';
import crypto from 'crypto';

const agentcore = new BedrockAgentCoreClient({ region: process.env.AWS_REGION_AGENTCORE });

export const handler: Schema['SlideJob']['onCreateHandler'] = async (event) => {
  const job = event.arguments;  // SlideJob レコード

  const sessionId = `slidev-${job.id}-${crypto.randomBytes(8).toString('hex')}`;
  const cmd = new InvokeAgentRuntimeCommand({
    agentRuntimeArn: process.env.AGENT_RUNTIME_ARN!,
    runtimeSessionId: sessionId,
    payload: new TextEncoder().encode(JSON.stringify({
      topic: job.topic, num_slides: job.numSlides, style: job.style,
      theme: job.theme, language: job.language, job_id: job.id,
    })),
  });

  const client = generateClient<Schema>();
  await client.models.SlideJob.update({ id: job.id, status: 'RUNNING' });

  try {
    const res = await agentcore.send(cmd);
    for await (const chunk of res.response!) {
      const text = new TextDecoder().decode(chunk);
      // SSE event を解釈してログ追記
      await client.models.SlideJob.update({
        id: job.id, logs: [...(job.logs ?? []), text.slice(0, 200)],
      });
    }
    await client.models.SlideJob.update({
      id: job.id, status: 'DONE', s3Key: `jobs/${job.id}/slides.md`,
    });
  } catch (err: any) {
    await client.models.SlideJob.update({
      id: job.id, status: 'FAILED', errorMessage: err.message,
    });
  }
};
```

> Lambda の起動方式は **AppSync の Mutation `onCreateSlideJob` のサブスクリプション通知** ではなく、**`createSlideJob` mutation のリゾルバとして直接 Pipeline で発火** するか、**DynamoDB Stream → Lambda** が現実的。Amplify Gen 2 の現在の慣習では `customMutation + handler` 方式が最も素直。詳細は §4.4 で示す。

### 4.3 フロントエンド (Next.js)

#### 4.3.1 ページ構成

| ルート | 機能 | 主な Amplify API |
|--------|------|------------------|
| `/` | ランディング、サインインボタン | (なし) |
| `/signin`, `/signup` | Cognito 認証 | `aws-amplify/auth` |
| `/generate` | トピック・枚数・スタイル・テーマ入力 → 送信 | `client.models.SlideJob.create(...)` |
| `/jobs/[id]` | リアルタイム進捗、完了後にプレビュー・ダウンロード | `client.models.SlideJob.observeQuery({ id })` (subscription) + `getUrl()` for S3 |
| `/dashboard` | 自分のジョブ履歴一覧 | `client.models.SlideJob.list()` |

#### 4.3.2 Slidev 表示戦略 (MVP)

| 戦略 | 方法 | 採否 |
|------|------|------|
| **A. Markdown ソース表示** | `<pre><code>` で生 .md を表示 + コピー & ダウンロード | ✅ MVP |
| **B. クライアント側 MD プレビュー** | `react-markdown` + `remark-gfm` で簡易レンダー、Slidev 独自記法 (`<v-click>`, `layout:` 等) は無視 | ✅ MVP の補助プレビュー |
| C. サーバ側 Slidev export | Lambda or ECS Fargate で `npx slidev export --format pdf` を実行し PDF 配布 | △ Phase 2 |
| D. Slidev iframe 埋め込み | 別 Amplify アプリで Slidev サーバを動かし iframe | × オーバースペック |

MVP は (A)+(B) で十分。Phase 2 で (C) を追加し、`/jobs/[id]` に「PDF Export」ボタンを設ける。

#### 4.3.3 進捗 UI

```
[Topic] Amazon Bedrock AgentCore の概要
[●●●●●○○○○○]  60% — Tool: web_search ("Bedrock AgentCore overview")
[Logs]
  ▸ Searching: Bedrock AgentCore overview
  ▸ Searching: AgentCore Runtime architecture
  ▸ Extracting: docs.aws.amazon.com/.../runtime.html
  ▸ Writing slides.md (10 slides)
  ▸ Validating layout fit ... overflow_count=2
  ▸ Regenerating slides 5, 7
  ▸ Validating layout fit ... all_fit=true
[✓ Complete]  s3://.../jobs/abc/slides.md   [Preview] [Download .md] [Export PDF]
```

ログは AppSync subscription で `SlideJob.logs` を観測。

### 4.4 ジョブ起動の制御フロー (詳細)

```
1. Frontend: client.models.SlideJob.create({...})
2. AppSync: SlideJob レコードを DynamoDB に PUT (status=PENDING)
3. DynamoDB Stream: INSERT イベントを generateSlides Lambda に配信
4. Lambda: status=RUNNING に更新 → InvokeAgentRuntime
5. Lambda: AgentCore からの SSE chunk を AppSync mutation で逐次反映
6. Lambda: 完了時 status=DONE, s3Key を更新
7. Frontend: SlideJob の subscription で進捗・完了を受信
```

**理由**: Amplify Gen 2 では `customMutation` から Lambda を直接 invoke する書き方も可能だが、Lambda 実行が長時間（最大 15 min）になるため、**フロントエンドのリクエストを 5xx で待たせない** 構造が必要。DynamoDB Stream 経由で非同期発火するのが最もシンプル。

### 4.5 `amplify.yml` (本番ビルド)

```yaml
version: 1
applications:
  - appRoot: web
    backend:
      phases:
        build:
          commands:
            - npm ci --cache .npm --prefer-offline
            - npx ampx pipeline-deploy --branch $AWS_BRANCH --app-id $AWS_APP_ID
    frontend:
      phases:
        preBuild:
          commands:
            - npm ci --cache .npm --prefer-offline
        build:
          commands:
            - npm run build
      artifacts:
        baseDirectory: .next
        files:
          - '**/*'
      cache:
        paths:
          - .npm/**/*
          - node_modules/**/*
```

> ルート直下にこの `amplify.yml` を置き、Amplify コンソールで `AMPLIFY_MONOREPO_APP_ROOT=web` を設定。

### 4.6 環境変数 / Secrets

| 変数 | 設定箇所 | 用途 |
|------|----------|------|
| `AGENT_RUNTIME_ARN` | Amplify Hosting > Environment variables | Lambda が呼び出す AgentCore の ARN |
| `AWS_REGION_AGENTCORE` | 同上 | AgentCore のリージョン (us-east-1) |
| (Cognito User Pool ID 等) | 自動生成 (`amplify_outputs.json`) | フロント設定 |

`AGENT_RUNTIME_ARN` は **AgentCore のデプロイが先**で、その出力を Amplify 環境変数に手動で登録する。CI で完全自動化したい場合は別途 CDK 化する。

---

## 5. データモデル

### 5.1 DynamoDB (AppSync `SlideJob` テーブル)

| 属性 | 型 | 例 |
|------|------|------|
| `id` (PK) | string | `01H...` (ULID 推奨) |
| `owner` | string | `cognito-sub` |
| `topic` | string | `Amazon Bedrock AgentCore の概要` |
| `numSlides` | number | `10` |
| `style` | enum | `technical` |
| `theme` | string | `penguin` |
| `language` | string | `ja` |
| `status` | enum | `PENDING` / `RUNNING` / `DONE` / `FAILED` |
| `s3Key` | string | `jobs/01H.../slides.md` |
| `logs` | list<string> | 進捗ログ |
| `errorMessage` | string | (失敗時のみ) |
| `createdAt`, `updatedAt` | datetime | 自動 |

GSI: `byOwner (owner, createdAt)` でダッシュボード表示。

### 5.2 S3 オブジェクトレイアウト

```
s3://amplify-slidev-...-slidesbucket/
└── jobs/
    └── {jobId}/
        ├── slides.md            ← write_slidev_markdown が出力
        ├── validate.json         ← validate_slides_fit のレポート (任意)
        └── slides.pdf            ← Phase 2: PDF export
```

ライフサイクル: 90 日後に Glacier Instant Retrieval、365 日後に削除（コスト最適化）。

---

## 6. 認証・認可

### 6.1 ユーザー認証

- Amazon Cognito User Pool (Email サインアップ)
- Amplify Auth UI (`@aws-amplify/ui-react`) を使ったサインイン

### 6.2 認可境界

| 主体 | リソース | アクション | 仕組み |
|------|---------|-----------|--------|
| End user | 自分の `SlideJob` | CRUD | AppSync `allow.owner()` |
| End user | 自分の S3 オブジェクト (`jobs/{owner}/...`) | GetObject (presigned URL) | Amplify Storage `entity_id` |
| `generate-slides` Lambda | AgentCore Runtime | InvokeAgentRuntime | IAM Role inline policy |
| AgentCore Runtime Execution Role | S3 (`jobs/*`) | PutObject/GetObject | 別途 CDK 等で付与 |
| AgentCore Runtime Execution Role | Bedrock | InvokeModel | Inline policy |
| AgentCore Runtime Execution Role | Secrets Manager (`slidev-agent/*`) | GetSecretValue | Inline policy |

### 6.3 ユーザー識別子の伝播

Lambda は Cognito JWT を検証して `sub` (cognito user id) を取得し、AgentCore に渡す `payload.user_id` に格納する。エージェント側はログ・S3 prefix・課金識別に利用。

---

## 7. デプロイ手順

### 7.1 一回限りの初期セットアップ

1. **Tavily API キーを Secrets Manager に登録**
   ```bash
   aws secretsmanager create-secret \
     --name slidev-agent/TAVILY_API_KEY \
     --secret-string "tvly-..."
   ```

2. **AgentCore Runtime のデプロイ**
   ```bash
   pip install bedrock-agentcore bedrock-agentcore-starter-toolkit
   agentcore configure --entrypoint src/slidev_agent/runtime.py
   #   → .bedrock_agentcore.yaml と Dockerfile を生成
   #   → リージョン (us-east-1)、ARM64、authorizer=IAM を選択
   agentcore launch
   #   → ECR ビルド/プッシュ + CreateAgentRuntime
   #   → 出力された AGENT_RUNTIME_ARN を控える
   ```

3. **Amplify Gen 2 アプリの作成**
   ```bash
   cd web
   npm create amplify@latest    # 既に作っていれば skip
   npx ampx sandbox             # ローカル検証 (個人クラウドサンドボックス)
   ```

4. **GitHub と Amplify Hosting を接続**
   - Amplify コンソールから Create new app → リポジトリ選択
   - `AMPLIFY_MONOREPO_APP_ROOT=web` を設定
   - 環境変数 `AGENT_RUNTIME_ARN` / `AWS_REGION_AGENTCORE` を登録
   - サービスロール `AmplifyConsoleServiceRole-AmplifyRole` をアタッチ

5. **AgentCore Execution Role に S3 / Bedrock / Secrets 権限を付与**
   - Amplify Storage の S3 バケット名は `npx ampx sandbox` 後の `amplify_outputs.json` で確認
   - 別途 CLI または CDK で AgentCore Execution Role に inline policy を追加

### 7.2 日常の開発フロー

| 変更箇所 | コマンド |
|---------|----------|
| エージェント Python | `agentcore launch` で再デプロイ (ECR re-push) |
| Amplify バックエンド | `git push` → Amplify Hosting CI/CD が `npx ampx pipeline-deploy` |
| フロントエンド | 同上 (`next build` 自動) |
| ローカル検証 | `npx ampx sandbox` (Amplify) + `agentcore launch --local` (AgentCore) |

### 7.3 Pull Request プレビュー

- Amplify Gen 2 + バックエンド込みアプリは PR Preview を有効化可（公開リポジトリのみ要注意）
- AgentCore は **PR ごとには別途デプロイしない**（コスト面で過剰）。共通の `staging` ARN を全 PR で参照する想定。

---

## 8. 観測性 (Observability)

| 層 | ログ/メトリクス | 場所 |
|----|------------------|------|
| AgentCore Runtime | Container stdout, AgentCore メトリクス | CloudWatch Logs `/aws/bedrock-agentcore/runtimes/<arn>` |
| Lambda (`generate-slides`) | invocation logs, errors | CloudWatch Logs `/aws/lambda/generate-slides-...` |
| AppSync | resolver logs (オプション) | CloudWatch Logs |
| Amplify Hosting | build logs, access logs | Amplify コンソール |
| Frontend | エラー/イベント | Cloudfront access log + Sentry (任意) |

主要アラーム:
- AgentCore: `Errors > 5 / 5 min`
- Lambda: `Throttles > 0`, `Errors > 1%`
- DynamoDB: `UserErrors`

---

## 9. コスト見積もり (us-east-1, 月 1,000 ジョブ想定, 1 ジョブ ≈ 3 分, 平均 10 スライド)

| サービス | 単価 | 月コスト目安 |
|---------|------|--------------|
| AgentCore Runtime | $0.0001/sec × 180 sec × 1000 | ≈ $18 |
| Bedrock Claude Opus 4.6 | 入出力 60K + 30K tokens × 1000 = 90M tokens | ≈ $750 (要見直し: モデルにより大幅変動) |
| Tavily API | $0.005 × 4 calls × 1000 | ≈ $20 |
| Lambda (generate-slides) | 1,000 × 180 sec × 1024MB | ≈ $3 |
| AppSync | 100K リクエスト + リアルタイム接続 | ≈ $4 |
| DynamoDB (on-demand) | 100K WCU + 200K RCU | ≈ $2 |
| S3 + CloudFront | < 10 GB ストレージ + 50 GB 転送 | ≈ $5 |
| Cognito | < 50,000 MAU 無料枠 | $0 |
| Amplify Hosting | ビルド 100 分 + 50 GB | ≈ $5 |
| **合計** | | **≈ $810/月** |

> 注: Bedrock 推論コストが支配的。Claude Sonnet 4.6 / Haiku 4.5 や Vertex AI Gemini に切り替えれば 1/3〜1/5 に圧縮可能。

---

## 10. リスク・落とし穴

| # | リスク | 緩和策 |
|---|--------|--------|
| R1 | AgentCore Runtime のリージョン制約 (preview 機能は限定リージョン) | us-east-1 を本番採用、Amplify と同一リージョンに揃える |
| R2 | IAM SigV4 と JWT 認証の排他制約 | フェーズ 1 は SigV4 のみ。将来エンドユーザー直接呼び出しが必要になったら別 ARN で JWT 版を追加 |
| R3 | AgentCore コンテナの `/tmp` セッション間消去 | 生成物は必ず S3 に書き出す (writer.py 改修済) |
| R4 | Lambda 15 分上限 | スライド数を 30 枚以下に制限。超過時は Step Functions に拡張 |
| R5 | AppSync subscription の WebSocket コスト | アイドル接続を切るタイムアウトを設定 |
| R6 | Slidev 独自記法 (v-click 等) はクライアントレンダー不可 | MVP は Markdown 表示 + ダウンロード前提。Phase 2 で Lambda export |
| R7 | Bedrock コスト爆発 | per-user 月次クォータ (DynamoDB カウンタ) を導入。`num_slides` 上限を 30 に |
| R8 | 公開リポジトリでの PR プレビュー時に IAM ロール悪用 | PR プレビューはプライベートリポジトリでのみ有効化 |
| R9 | Tavily API キー漏洩 | Secrets Manager + AgentCore Execution Role 経由のみ参照、Lambda には渡さない |
| R10 | Strands Agents の `stream_async` イベント形式が AgentCore SSE 仕様とズレる | デプロイ前に `agentcore launch --local` + `agentcore invoke` でスモークテスト |

---

## 11. 段階的ロードマップ

### Phase 1 (MVP — 2 週間)
- [ ] `runtime.py` を `BedrockAgentCoreApp` に書き換え
- [ ] `writer.py` の S3 対応
- [ ] `agentcore configure` + `agentcore launch` で staging ARN を確保
- [ ] Amplify Gen 2 backend (Auth + Data + Storage + 1 Lambda) を `web/` に作成
- [ ] `/generate` `/jobs/[id]` `/dashboard` 3 ページの最小 UI
- [ ] DynamoDB Stream で Lambda 発火 → AgentCore 呼び出し
- [ ] AppSync subscription による進捗表示
- [ ] Markdown ソース表示 + ダウンロード

### Phase 2 (UX 強化 — 1 週間)
- [ ] `react-markdown` で簡易プレビュー
- [ ] Lambda or ECS Fargate で Slidev `export` 実行 → PDF 配布
- [ ] PR プレビュー設定
- [ ] CloudWatch Dashboards / アラーム

### Phase 3 (運用強化)
- [ ] CDK 化 (AgentCore + Amplify を 1 IaC に統合)
- [ ] Step Functions 化 (`num_slides > 30`)
- [ ] カスタムドメイン
- [ ] 月次利用量ダッシュボード
- [ ] Vertex AI Gemini との A/B 切り替え UI

---

## 12. オープンクエスチョン

1. **モデル既定**: Claude Opus 4.6 を全ユーザー既定にするか、料金抑制で Sonnet 4.6 既定 + Opus はオプション化するか？
2. **マルチリージョン**: 災害対策として ap-northeast-1 にもデプロイするか？ (AgentCore 可用性確認要)
3. **共有 staging ARN**: PR プレビューで共有 ARN を使うとログが混ざる。タグで分離するか、PR ごとに ARN を切るか？
4. **スライド画像生成**: Slidev の画像 (mermaid・diagram) 自動生成が必要なら、Amplify storage の signed URL 経由で生成 Lambda を別建てるか？
5. **既存 CLI の扱い**: 既存の `slidev-agent` CLI は維持するか、Web UI に一本化するか？

---

## 付録 A. 参考リンク

- [Amazon Bedrock AgentCore Runtime — User Guide](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime.html)
- [bedrock-agentcore-starter-toolkit (GitHub)](https://github.com/aws/bedrock-agentcore-starter-toolkit)
- [Strands Agents — Deploy to AgentCore](https://strandsagents.com/latest/documentation/docs/user-guide/deploy/deploy_to_bedrock_agentcore/)
- [Amplify Gen 2 — Build a backend](https://docs.amplify.aws/react/build-a-backend/)
- [Amplify Gen 2 — Custom resources (CDK)](https://docs.amplify.aws/react/build-a-backend/add-aws-services/custom-resources/)
- 社内ガイド: `/Users/hiruta/aws-amplify-deployment-guide.md`
