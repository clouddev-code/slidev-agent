# slidev-agent チームレビュー — Amplify (Frontend) × AgentCore Runtime (Backend) × CDK (IaC)

レビュー対象コミット: `5b35091 feat: Add Bedrock AgentCore runtime and Amplify-hosted Next.js web UI`
レビューチーム: CDK / IaC レビュアー (`cdk-code-reviewer`)、AWS バックエンドレビュアー (`aws-researcher`)、フロントエンドレビュアー (`general-purpose`) の3名並列実行
レビュー日: 2026-05-09

---

## 0. エグゼクティブサマリー

3名のレビュアーが独立に検出した結果を統合すると、以下の **Critical (本番ブロッカー) が4件** あります。とくに **Critical-A の Storage 認可と書き込みパスの不整合** は CDK / Frontend / Backend の3観点 (それぞれの責務領域) すべてで独立に検出されており、合議で確定したシステム全体のバグです。これは「ジョブが完了しても本人がスライドをダウンロードできない」状態を引き起こす根本欠陥のため、最優先で修正してください。

| #   | 観点               | 内容                                                                                                                                                  | 影響                                                                |
| --- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| A   | IaC / FE / BE 共通 | Storage 認可ルール `jobs/{entity_id}/*` (Cognito Identity ID) と Lambda が書く S3 キー `jobs/${ULID}/slides.md` の不整合                               | DONE 後にユーザーが `getUrl()` 実行しても `AccessDenied` で取れない |
| B   | Frontend           | `web/app/signin/page.tsx` の `Authenticator` render-prop callback 内で `useEffect` を呼ぶ Rules of Hooks 違反                                          | サインイン画面が React 例外で落ちる可能性                           |
| C   | Backend            | `agent.py:_writer_invocation_state()` の戻り値がどこからも参照されていない。Writer が `output_path` (S3 URI) を invocation_state 経由で受け取れない   | Writer LLM が誤った path を選んだ場合、生成物がジョブ ID 配下に正しく保存されない |
| D   | Backend / IaC      | Bedrock cross-region inference profile ID `us.anthropic.claude-opus-4-6-v1` に version suffix `:0` が欠落し、Bedrock が `ValidationException` を返す | エージェント呼び出しが起動直後にすべて失敗                          |

それ以外に High 8 件 / Medium 9 件 / Low 6 件を以下の各章で整理します。

---

## 1. クロスチェックされた重要事項 (3観点が一致した発見)

### 1.1 [Critical] Storage の `entity_id` (Cognito Identity ID) と Lambda が書く `job.id` (ULID) の不整合

**該当ファイル / 行**
- `web/amplify/storage/resource.ts:17` (認可ルール定義)
- `web/amplify/functions/generate-slides/handler.ts:138` (Lambda 書き込み)
- `web/components/JobProgress.tsx:52` (フロント `getUrl({ path: job.s3Key })`)

**根拠 (Amplify Gen 2 公式)**
- [Storage authorization](https://docs.amplify.aws/nextjs/build-a-backend/storage/authorization/)
  > "The `entity_id` is a reserved token that will be replaced with the users' identifier when the file is being uploaded… Currently, **Identity Pool** is the only identification method available."

**現状コード**
```ts
// storage/resource.ts:17
'jobs/{entity_id}/*': [
  allow.entity('identity').to(['read']),
  allow.resource(generateSlides).to(['read', 'write']),
],
```
```ts
// handler.ts:138
const s3Key = `jobs/${job.id}/slides.md`;  // job.id は ULID であって Identity ID ではない
```

**問題**
`{entity_id}` は Cognito Identity Pool の identityId (例 `us-east-1:xxxx-xxxx-...`) に解決される。一方 Lambda は ULID (Amplify が SlideJob モデルに付ける ID) で書き込んでいるため、**正規ユーザーが自分の生成物を読むパスが認可ルールに一致しない**。Lambda 自身は `allow.resource(generateSlides)` 側で認可されているので書き込みは成功する。

**推奨修正 (案 A: identityId をキーに含める)**
1. `data/resource.ts` の `SlideJob` に `identityId: a.string().required()` を追加
2. `SlideForm.tsx` で `await fetchAuthSession()` から identityId を取得し mutation に乗せる
3. `handler.ts` で `s3Key = \`jobs/${job.identityId}/${job.id}/slides.md\`` に変更
4. `storage/resource.ts` を `'jobs/{entity_id}/*'` のままにして、ファイル名末尾に `${job.id}/slides.md` を含めて衝突回避

**推奨修正 (案 B: 認可をオーナースコープに切り替え)**
`storage/resource.ts` を `'jobs/*'` + `allow.authenticated.to(['read'])` にし、AppSync の `allow.owner()` でユーザー間の漏洩を防ぐ — ただし Storage レベルでは横断読み取り可能になる弱化。

最小権限原則に合致するのは **案 A**。

---

## 2. CDK / IaC レビュー (cdk-code-reviewer)

### 2.1 [High] `bedrock:InvokeModel` の `resources: ['*']` を絞り込む
**`infra/lib/slidev-agent-runtime-stack.ts:65-71`**

[Service Authorization Reference / Amazon Bedrock](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazonbedrock.html) によると、`InvokeModel` は `foundation-model` / `inference-profile` / `application-inference-profile` のリソース ARN を指定できる。

```ts
resources: [
  `arn:${this.partition}:bedrock:${this.region}:${this.account}:inference-profile/${props.bedrockModelId}`,
  `arn:${this.partition}:bedrock:us-east-1::foundation-model/anthropic.claude-opus-4-6*`,
  `arn:${this.partition}:bedrock:us-west-2::foundation-model/anthropic.claude-opus-4-6*`,
],
```

### 2.2 [High] DynamoDB Streams ポリシーの `resources: ['*']` を絞り込む
**`web/amplify/backend.ts:26-38`**

`slideJobTable.tableStreamArn` と `slideJobTable.tableArn` を直接渡せばよい。

### 2.3 [High] `bedrockModelId` のバージョン suffix `:0` 欠落
**`infra/bin/slidev-agent-infra.ts:22` / `infra/lib/slidev-agent-runtime-stack.ts:49`**

クロスリージョン inference profile ID は `us.anthropic.claude-opus-4-6-v1:0` の形式 ([Inference profiles support](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-support.html))。suffix なしだと `ValidationException`。**これは Critical-D として再掲。**

### 2.4 [High] Lambda timeout 900s + DynamoDB Streams 同期呼び出しの設計リスク
**`web/amplify/functions/generate-slides/resource.ts:11`**

[Using AWS Lambda with Amazon DynamoDB](https://docs.aws.amazon.com/lambda/latest/dg/with-ddb.html) によると DDB Streams は失敗時にバッチ全体を再試行する。AgentCore SSE を 5〜15 分同期 await している間にタイムアウトすると同じジョブが再走する。

**推奨**: `INSERT` を SQS にエンキュー → Lambda は SQS イベントソース、または Step Functions Express に置き換え。最低限 `bisectBatchOnError: true` と冪等チェック (status==PENDING のみ走らせる) を実装する。

### 2.5 [Medium] `bedrock-agentcore:InvokeAgentRuntime` の絞り込み (`backend.ts:57-68`)

Runtime ARN を SSM `/slidev-agent/agent-runtime-arn` から取得して `resources: [arn]` に渡す。

### 2.6 [Medium] `bucket.grantReadWrite(... 'jobs/*')` → `grantPut` で十分
**`infra/lib/slidev-agent-runtime-stack.ts:90`** AgentCore Runtime は読まない。

### 2.7 [Medium] `data/resource.ts` の `allow.resource(generateSlides).to(['read','update'])` と `backend.ts:74-83` の手書き `appsync:GraphQL` ポリシーが二重

Amplify Gen 2 の `allow.resource()` は IAM 権限も自動付与するため、`backend.ts` 側の手書きを削除。

### 2.8 [Medium] `LogRetention` のロググループ名が AgentCore の実際の名前と一致するか未確認
**`infra/lib/slidev-agent-runtime-stack.ts:94-97`**

`/aws/bedrock-agentcore/runtimes/${agentRuntimeId}` パターンが公式ドキュメントに明記されていない。デプロイ後に CloudWatch コンソールで実名確認 → 必要なら Aspect で全ロググループ一括設定に変更。

### 2.9 [Medium] `cdk.json` の推奨フィーチャーフラグ追加
- `@aws-cdk/aws-iam:standardizedServicePrincipals: true`
- `@aws-cdk/aws-lambda:recognizeLayerVersion: true`
- `@aws-cdk/core:validateSnapshotRemovalPolicy: true`

### 2.10 [Low] `networkConfiguration: PublicNetwork` は本構成で適切 (Secrets Manager / S3 / Bedrock のみ呼ぶため)
### 2.11 [Low] `lifecycleConfiguration` (idle 30 分 / max 2 時間) はほぼ妥当
### 2.12 [Low] Dockerfile の `uv sync --frozen || uv pip install --system .` フォールバックを削除
### 2.13 [Low] `--platform=linux/arm64` 強制は AgentCore 要件として正しい

---

## 3. バックエンドレビュー (Bedrock AgentCore Runtime + Strands Graph)

詳細レポート: [`research/ai-slidev-agent-backend-review.md`](../research/ai-slidev-agent-backend-review.md)

### 3.1 [Critical] `_writer_invocation_state` の戻り値が未使用 (= bug)
**`src/slidev_agent/agent.py:221-230` / `runtime.py:98`**

[Strands Multi-Agent Shared State](https://strandsagents.com/docs/user-guide/concepts/multi-agent/multi-agent-patterns/index.md#shared-state-across-multi-agent-patterns):
> "Both Graph and Swarm patterns support passing shared state to all agents through the `invocation_state` parameter."

```python
# runtime.py 修正
async for event in graph.stream_async(
    seed,
    invocation_state=_writer_invocation_state(config),
):
```

加えて `write_slidev_markdown` / `validate_slides_fit` を `@tool(context=True)` に変更し、`tool_context.invocation_state["output_path"]` から S3 URI を必須引数として読むようにすれば、LLM が path を書き換えるリスクが排除される。

### 3.2 [High] `reset_on_revisit(True)` で writer が直前の validator 指摘を忘れる
**`agent.py:314`**

フィードバックループでは `False` の方が「validator の指摘を踏まえて writer が修正する」挙動が成立しやすい。`True` のままにする場合は validator 出力を `invocation_state` 経由で次回 writer 実行へ明示的に渡す。

### 3.3 [High] フィードバック条件が "revision needed" 文字列部分一致 → 出力言語が変わると暗黙承認
**`agent.py:_needs_revision`**

LLM が日本語で「要修正」と書いた瞬間にグラフが暗黙的に終了する。Pydantic モデルで structured output を強制するか、condition 関数に日本語フォールバック (`"要修正" in text`) を追加。

### 3.4 [High] `multiagent_node_stream` で toolUse / toolResult を取りこぼし
**`runtime.py:107-118`**

[Streaming Responses](https://strandsagents.com/docs/user-guide/concepts/streaming/index.md#event-types) によるとネストされた `event.current_tool_use` がツール呼び出し情報を持つが、現コードは無視している。Lambda 側の進捗ログにツール起動が表示されず、ユーザーは「何が起きているか」分からない。

### 3.5 [High] Dockerfile の `uv sync` 失敗時フォールバックで venv パスがズレる
**`Dockerfile:21`**

`uv sync --frozen` は `.venv/lib/python3.13/site-packages/` に入るのに対し、フォールバックの `uv pip install --system .` は `/usr/local/lib/python3.13/site-packages/` に入る。`COPY --from=builder /usr/local/lib/python3.13` は前者を拾わない。**フォールバックを削除する**か、`uv pip install --system` のみに統一する。

```dockerfile
RUN uv pip install --system --no-cache .
```

### 3.6 [Medium] `context.session_id` の属性名は公式仕様に未記載 (`runtime.py:49`)
公式は `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id` ヘッダだけが規定。`payload["job_id"]` を必須に。

### 3.7 [Medium] `set_max_node_executions(12)` でコメントの「最大3回」と実際の「最大5往復」が不一致
**`agent.py:312`** → `set_max_node_executions(8)` (planner+researcher+writer/validator×3往復)。

### 3.8 [Medium] `_writer_seed_message` の system_prompt 文字列連結を `invocation_state` に移行 (3.1 と連動)

### 3.9 [Medium] `boto3.client("s3")` をリクエストごとに都度生成
**`tools/writer.py:42` / `tools/validator.py:35`**

AgentCore Runtime はコンテナを生かし続けるので、モジュールレベルでクライアントをキャッシュ:
```python
from functools import lru_cache
@lru_cache(maxsize=1)
def _s3() -> "boto3.client":
    return boto3.client("s3")
```

### 3.10 [Medium] `text[:1000]` (runtime.py) と Lambda 側 `[:160]` の二重切り詰め
責務を Lambda 側に一本化し runtime.py は素通し。

### 3.11 [Low] `_CJK_RE` を `unicodedata.east_asian_width()` に置き換え (`tools/validator.py:301`)
### 3.12 [Low] `_DOC_FM_RE` がコードフェンス内 `---` に誤反応する可能性 (`tools/validator.py:103`)

---

## 4. フロントエンドレビュー (Next.js 14 App Router + Amplify Gen 2)

### 4.1 [Critical] `signin/page.tsx` で render-prop callback 内 `useEffect` (Rules of Hooks 違反)
**`web/app/signin/page.tsx:13`**

[React Rules of Hooks](https://react.dev/reference/rules/rules-of-hooks):
> "Don't call Hooks inside loops, conditions, **nested functions**, or try/catch/finally blocks."

修正:
```tsx
function RedirectIfSignedIn() {
  const { user } = useAuthenticator((c) => [c.user]);
  const router = useRouter();
  useEffect(() => { if (user) router.replace('/generate'); }, [user, router]);
  return <p className="muted">Redirecting…</p>;
}
export default function SignInPage() {
  return <Authenticator><RedirectIfSignedIn /></Authenticator>;
}
```

### 4.2 [Critical] `Amplify.configure()` が import 副作用として 2 重に呼ばれている
**`web/lib/amplify-client.ts:16` (モジュールトップ即時実行) + `web/app/providers.tsx:6`**

[Amplify Gen 2 SSR docs](https://docs.amplify.aws/nextjs/build-a-backend/server-side-rendering/) は専用の `ConfigureAmplifyClientSide` Client Component を 1 個作って `layout.tsx` で 1 回マウントするパターンを推奨。

```tsx
// app/ConfigureAmplifyClientSide.tsx
'use client';
import { Amplify } from 'aws-amplify';
import outputs from '@/amplify_outputs.json';
Amplify.configure(outputs, { ssr: true });
export default function ConfigureAmplifyClientSide() { return null; }
```

`lib/amplify-client.ts` は `client = generateClient<Schema>()` のエクスポートだけに削減し、`providers.tsx` は削除。

### 4.3 [High] バックエンド専用依存が `web/dependencies` に混入
**`web/package.json:14-33`**

`@aws-sdk/client-bedrock-agentcore` / `@aws-sdk/credential-provider-node` / `@smithy/*` / `@aws-crypto/sha256-js` / `aws-cdk-lib` / `constructs` / `@types/aws-lambda` / `esbuild` を `devDependencies` に移動。これらは `amplify/functions/generate-slides/handler.ts` と `amplify/backend.ts` でのみ使われるが、`ampx pipeline-deploy` 側でバンドルされるため Next.js 本体は不要。

### 4.4 [High] `Amplify.configure({ ssr: true })` を Client Component から呼ぶ → `adapter-nextjs` が未活用
**`web/lib/amplify-client.ts:12`**

`ssr: true` は Cookie 化の効果はあるが、Server Component から `runWithAmplifyServerContext` で fetch する真の SSR は使われていない。MVP で許容するなら問題ないが、`@aws-amplify/adapter-nextjs` を依存に入れたまま CSR のみは無駄なバンドル増。

### 4.5 [Medium] `JobProgress` の単一レコード `observeQuery({ filter: { id: { eq: id } } })` が非効率
**`web/components/JobProgress.tsx:27`**

`get` + `onUpdate` の組み合わせの方がトラフィック軽い。

### 4.6 [Medium] `dashboard` の `observeQuery()` 全件取得にページング無し
**`web/app/dashboard/page.tsx:21`**

履歴が増えると初回ロードが重くなる。`limit` + `nextToken` 併用に。

### 4.7 [Medium] `getUrl({ path, options: { expiresIn: 600 } })` の URL 期限切れ未ハンドル
**`web/components/JobProgress.tsx:52`**

10 分 1 回しか取得しないので、長居すると URL が無効。9 分間隔で再取得する `setInterval` を入れる。

### 4.8 [Medium] FAILED ジョブの再試行 UI なし (`JobProgress.tsx`)
### 4.9 [Medium] `item.status as JobStatus` の握り潰しキャスト (`JobProgress.tsx:36`) — `STATUSES.includes` でガード
### 4.10 [Medium] `SlideForm.tsx` の `style` 文字列と `data/resource.ts` の `a.enum` を `SLIDE_STYLES` 定数で DRY 化

### 4.11 [Low] Identity Pool guest を `allowUnauthenticatedIdentities = false` に
### 4.12 [Low] `next.config.mjs` の `serverActions.bodySizeLimit` は不要 (Server Action 未使用)
### 4.13 [Low] `Authenticator.Provider` (layout) と各 page の `<Authenticator>` が二重 — `useAuthenticator` で `route !== 'authenticated'` 時に `router.replace('/signin')` する形に整理

---

## 5. 修正優先度サマリー

### 5.1 すぐ対応 (Critical: ジョブが回らない / 落ちる)

| #   | ファイル                                                         | 内容                                            |
| --- | ---------------------------------------------------------------- | ----------------------------------------------- |
| 1   | `infra/bin/slidev-agent-infra.ts:22`                             | `bedrockModelId` に `:0` suffix を付与          |
| 2   | `web/amplify/storage/resource.ts:17` + `handler.ts:138` + `data/resource.ts` | `identityId` を SlideJob に追加し S3 キーを `jobs/${identityId}/${job.id}/slides.md` に |
| 3   | `web/app/signin/page.tsx`                                        | render-prop 内 `useEffect` を別 Component に分離 |
| 4   | `src/slidev_agent/runtime.py:98` + `agent.py:tools`              | `invocation_state` を `stream_async` に渡し、ツールに `@tool(context=True)` 適用 |

### 5.2 リリース前に対応 (High: 本番で確実に問題化)

| #   | ファイル                                                | 内容                                                    |
| --- | ------------------------------------------------------- | ------------------------------------------------------- |
| 5   | `web/lib/amplify-client.ts` + `providers.tsx`           | `ConfigureAmplifyClientSide` パターンに統一              |
| 6   | `infra/lib/slidev-agent-runtime-stack.ts:65-71`         | `bedrock:InvokeModel` resource を inference-profile ARN で絞る |
| 7   | `web/amplify/backend.ts:26-38`                          | DynamoDB Streams resource を tableStreamArn / tableArn で絞る |
| 8   | `web/amplify/functions/generate-slides/resource.ts:11`  | DDB Streams + 同期 SSE を SQS / Step Functions に置き換え |
| 9   | `web/package.json`                                      | バックエンド依存を `devDependencies` に移動              |
| 10  | `src/slidev_agent/agent.py:314`                         | `reset_on_revisit(False)` を検討                        |
| 11  | `src/slidev_agent/agent.py:_needs_revision`             | structured output または日本語フォールバック追加         |
| 12  | `src/slidev_agent/runtime.py:107-118`                   | `current_tool_use` を `node_tool` イベントとして転送    |
| 13  | `Dockerfile:21`                                         | `uv sync` フォールバックを削除し方式統一                 |

### 5.3 余裕があれば対応 (Medium / Low)

`backend.ts` の `appsync:GraphQL` 重複削除、`grantPut` への変更、`LogRetention` のロググループ名検証、`max_node_executions` を 8 に、`boto3` クライアントキャッシュ、`observeQuery` ページング、`SlidevPreview` URL 有効期限管理、再試行 UI、Identity Pool guest 無効化、`unicodedata.east_asian_width` 利用、cdk.json フィーチャーフラグ追加 — 詳細は各章 § 2 / § 3 / § 4 を参照。

---

## 6. アーキテクチャ全体の所感

- **設計の良いところ**: ジョブ非同期化 (DDB Streams → Lambda) / ストリーミング進捗 (SSE → AppSync subscription) / 認可レイヤ分離 (AppSync owner-auth + Storage entity-auth) / マルチエージェント (planner→researcher→writer→validator のフィードバックループ) はいずれも筋が良い。
- **改善が必要な構造的論点**: 
  1. **長時間 SSE 同期処理を Lambda で受ける構造**: 5〜15 分の処理を 900s Lambda で握り続けるのは DDB Streams 再試行と相性が悪い。SQS / Step Functions Express に切り替えるか、AgentCore の async invoke (`invokeAgentRuntimeAsync`) パターンに移行すべき。
  2. **認可スキーマの一貫性**: Storage の `entity_id` (Cognito Identity) と Data の `owner` (Cognito sub) が別軸で、両者を整合させる設計が現状欠けている。SlideJob モデルに identityId を載せる方式が最もシンプル。
  3. **`invocation_state` の活用不足**: Strands Graph の system_prompt 文字列連結ではなく `invocation_state` で構成パラメータを渡す方式に揃えると、tool 呼び出しの型安全性も上がる。
- **CDK 設計の評価**: `@aws-cdk/aws-bedrock-agentcore-alpha` L2 の使い方は概ね妥当。Tavily key を Secrets Manager から runtime 内で取得する設計はクレデンシャルの最小露出として良い。

---

## 7. 参考ドキュメント

### CDK / AWS
- [AWS Bedrock Service Authorization](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazonbedrock.html)
- [Bedrock cross-region inference profiles support](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-support.html)
- [Lambda with DynamoDB Streams](https://docs.aws.amazon.com/lambda/latest/dg/with-ddb.html)
- [CDK Best Practices](https://docs.aws.amazon.com/cdk/v2/guide/best-practices.html)
- [Amazon Bedrock AgentCore Devguide](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html)

### Strands Agents
- [Multi-Agent — Graph](https://strandsagents.com/docs/user-guide/concepts/multi-agent/graph/index.md)
- [Multi-Agent Patterns / Shared State (`invocation_state`)](https://strandsagents.com/docs/user-guide/concepts/multi-agent/multi-agent-patterns/index.md#shared-state-across-multi-agent-patterns)
- [Streaming Responses / Event Types](https://strandsagents.com/docs/user-guide/concepts/streaming/index.md#event-types)
- [Deploy to Bedrock AgentCore (Python)](https://strandsagents.com/docs/user-guide/deploy/deploy_to_bedrock_agentcore/python/index.md)

### Amplify Gen 2 / Next.js / React
- [Amplify SSR (Next.js App Router)](https://docs.amplify.aws/nextjs/build-a-backend/server-side-rendering/)
- [Amplify Storage authorization](https://docs.amplify.aws/nextjs/build-a-backend/storage/authorization/)
- [Amplify Storage download (`path:`)](https://docs.amplify.aws/nextjs/build-a-backend/storage/download-files/)
- [Amplify Data subscribe (`observeQuery`)](https://docs.amplify.aws/nextjs/build-a-backend/data/subscribe-data/)
- [Amplify Auth guest access (Identity Pool)](https://docs.amplify.aws/react/build-a-backend/auth/concepts/guest-access/)
- [React Rules of Hooks](https://react.dev/reference/rules/rules-of-hooks)
- [Next.js App Router: Server / Client Components](https://nextjs.org/docs/app/building-your-application/rendering/server-components)
