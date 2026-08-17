# HANDOFF — AG-UI ローカル動作確認 (slidev-agent)

保存日時: セッション継続中に context 104% で緊急保存。
ブランチ: `feature/agentcore-amplify-deployment`

## ゴール

slidev-agent (CLIベースでSlidev形式Markdownを出力するAgent) のフロントエンドとして
AG-UI protocol を検討 → ローカルで Backend/Frontend 両方動かし、Bedrock は
`aws sso login` 済みセッションで認証させて動作確認するところまで。

## 完了事項

### 1. アーキテクチャ調査・決定事項

- **AG-UI event schema** はGitHub `ag-ui-protocol/ag-ui` の
  `sdks/python/ag_ui/core/events.py` / `types.py` から直接ソース確認済み
  (RUN_STARTED/RUN_FINISHED/RUN_ERROR, STEP_STARTED/FINISHED,
  TEXT_MESSAGE_*, TOOL_CALL_*, STATE_SNAPSHOT/DELTA 等)。
- **既存の公式Strands統合を発見・採用**: `ag-ui-protocol/ag-ui` リポジトリの
  `integrations/aws-strands/python/`（PyPI: `ag_ui_strands`）が
  `strands.Agent` を AG-UI protocol でラップする公式パッケージ。
  自前でイベント変換コードを書く必要はなかった。
  - `StrandsAgent(agent, name, description)` + `create_strands_app(agui_agent, path)`
    で FastAPI app が得られる。
  - README に **Bedrock AgentCore ネイティブ対応**の記載あり:
    `agentcore configure -e my_agui_server.py --protocol AGUI` で
    そのままAgentCoreにデプロイ可能 (`bedrock-agentcore-starter-toolkit`)。
    AC の場合 port 8080, `/invocations` (POST), `/ping` (GET) を要求。
    → 将来 Amplify/AppSync の独自SSE中継をこちらに置き換えられる可能性あり(未検証)。
- **重要な制約**: `ag_ui_strands.StrandsAgent` は単一の `strands.Agent` をラップする
  設計で、`agent.py` の `create_slidev_graph()`（GraphBuilder による
  planner→researcher→writer→validator のマルチエージェント）には未対応。
  そのため **今回は CLI と同じ単一Agent経路 (`create_slidev_agent()`) を使用**。
  マルチエージェントGraphのAG-UI対応（STEP_STARTED/STEP_FINISHED +
  MultiAgentHandoff カスタムイベントで表現できる可能性はドキュメントに記載あり）は
  別タスクとして未着手。
- **フロントエンド構成の選択**: ユーザーに確認の上、「CopilotKit + Next.js
  (create-ag-ui-app)」を選択。ただし実際には `create-ag-ui-app` /
  `npx copilotkit@latest create` CLI は使わなかった
  — このCLIは内部で CopilotKit の「Ops/Clerk platform」クラウドアカウントに
  プロジェクト作成を紐付ける仕様であることが判明し、純粋ローカル検証の
  意図に反するため回避。代わりに `create-next-app` で素のNext.jsを作り、
  CopilotKitパッケージを手動配線。
- **CopilotKit API確認方法**: `@copilotkit/react-core` に `/v2` サブパス
  export が存在し (`@copilotkit/react-core/v2` に `CopilotKit` と
  `CopilotChat` の両方がある)、CopilotKit公式リポジトリの
  showcase デモ (`CopilotKit/CopilotKit` repo,
  `showcase/integrations/strands/src/app/demos/agentic-chat/page.tsx`)
  が実際にこのv2 APIパターンを使っているのを確認し、それに合わせた。
  (`@copilotkit/react-ui` の v1 `CopilotChat` は使っていない)

### 2. 作成・変更したファイル

**Backend:**
- `src/slidev_agent/agui_server.py` (新規) — `ag_ui_strands.StrandsAgent` +
  `create_strands_app()` で `create_slidev_agent()` をAG-UI化。
- `pyproject.toml` / `uv.lock` — `uv add ag_ui_strands fastapi "uvicorn[standard]"`
  で依存追加済み。

**Frontend (`web/` を丸ごと新規作成):**
- `npx create-next-app@latest web --typescript --eslint --app --no-tailwind
  --no-src-dir --import-alias "@/*" --use-npm --no-turbopack`
  (Next.js 16.2.12 がインストールされた。**Next.js 16は破壊的変更ありと
  `web/AGENTS.md` に警告あり** — 追加編集前に `node_modules/next/dist/docs/`
  を確認すること)
- `npm install @copilotkit/react-core @copilotkit/react-ui @copilotkit/runtime @ag-ui/client`
  (`@copilotkit/react-ui` は結局未使用。`npm uninstall` はパーミッション拒否され
  そのまま残っている → 要クリーンアップ)
- `web/app/api/copilotkit/route.ts` — `CopilotRuntime({ agents: { "slidev-agent":
  new HttpAgent({ url: process.env.AGENT_URL ?? "http://localhost:8000/" }) } })`
  + `copilotRuntimeNextJSAppRouterEndpoint()`。`ExperimentalEmptyAdapter` 使用
  (LLM直結せず、agentsのみ使う場合の公式パターン)。
- `web/app/providers.tsx` (新規) — `<CopilotKit runtimeUrl="/api/copilotkit"
  agent="slidev-agent">` (v2 API, `@copilotkit/react-core/v2`から import)
- `web/app/page.tsx` — `<CopilotChat agentId="slidev-agent" />` に書き換え
  (元のcreate-next-appデフォルトページを置き換え)
- `web/app/layout.tsx` — `import "@copilotkit/react-core/v2/styles.css"`
  追加、`<Providers>` でchildrenをラップ
- `web/app/page.module.css` — 不要になったため削除済み

### 3. 動作確認結果

- **Backend単体**: `uv run uvicorn slidev_agent.agui_server:app --port 8000`
  起動 → curl で実際に3枚スライド生成をPOSTし、
  `RUN_STARTED → TOOL_CALL(web_search) → TOOL_CALL(write_slidev_markdown) →
  TOOL_CALL(validate_slides_fit) → RUN_FINISHED` のSSEを確認。
  Bedrock呼び出しは既存の `aws sso login` セッション（account
  905860205176, AdministratorAccess ロール）でそのまま認証成功。
  `output/agui_test.md` に実ファイル生成済み（**テスト成果物なのでcommit
  対象から除外/削除を検討**）。
- **Frontend単体**: `npx tsc --noEmit` エラーなし。`npm run dev`
  (port 3000, Turbopack) で `GET /` 200。
- **疎通確認**: `open http://localhost:3000` でブラウザを開いた時点で、
  ブラウザ→`POST /api/copilotkit`(Next.js)→`POST /`(backend:8000) の
  チェーンが両方 200 で通ることをサーバーログで確認済み。
- **未確認**: ユーザーが実際にチャット欄にトピックを入力し、ブラウザ上で
  スライド生成が最後まで流れて見えるかの目視確認は、ユーザーに依頼した
  ところで context 104% により中断。**次に再開したらまずここを確認する。**

### 4. バックグラウンドプロセス

このセッション中に起動（`disown` 済み、セッションが切れていたら再起動が必要）:
```bash
# Backend (port 8000)
uv run uvicorn slidev_agent.agui_server:app --port 8000

# Frontend (port 3000)
cd web && npm run dev
```
ログは session-specific scratchpad
(`/private/tmp/claude-501/.../scratchpad/agui_server.log`,
`web_dev.log`) に出力していたが、**このパスは前セッション専用で新セッションでは
消えている可能性が高い**。再開時は上記コマンドで再起動し、
`curl http://localhost:8000/ping` と `curl -o /dev/null -w '%{http_code}'
http://localhost:3000/` で生存確認すること。

## TODO / 次のステップ

1. **最優先**: ユーザーにブラウザ (`http://localhost:3000`) でチャットに
   トピックを打ち込んでもらい、E2Eでスライド生成が見えるか確認。
2. `@copilotkit/react-ui` の未使用依存を `web/package.json` から削除
   （前回 `npm uninstall` がパーミッション拒否されたため保留中）。
3. `output/agui_test.md` はテスト成果物 — commit時に含めない/削除を検討。
4. マルチエージェントGraph (`create_slidev_graph`, `runtime.py`) を
   AG-UIで表現する方法の調査（STEP_STARTED/FINISHED +
   MultiAgentHandoff カスタムイベント）。現状はCLIと同じ単一Agent限定。
5. AgentCoreへの `--protocol AGUI` ネイティブデプロイの検証
   (Amplify/AppSyncのSSE中継を置き換えられるか、社内レビューで指摘された
   「Lambdaで5〜15分のSSEを保持する構造」問題の解消につながるか)。
6. まだ何もgit commitしていない。新規ファイル一式（`agui_server.py`,
   `pyproject.toml`/`uv.lock`差分, `web/`全体）はすべて未コミットの
   working tree変更。
