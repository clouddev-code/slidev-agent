# Frontend ローカル動作確認手順

対象: `web/`（Next.js + CopilotKit + AG-UI）と `src/slidev_agent/agui_server.py`（AG-UI protocol / FastAPI backend）を
ローカルで疎通させ、ブラウザからスライド生成のE2Eを確認する手順。

## 前提条件

- Node.js: `nvm use 22.23.2`
- Python: `uv` がインストール済み（`uv sync` で依存解決）
- `.env` に以下が設定済みであること（`.env.example` 参照）
  - `TAVILY_API_KEY`（Web検索ツールに必須）
  - `MODEL_PROVIDER=bedrock`（デフォルト）の場合、AWS認証が必要
- Bedrockを使う場合、AWS SSOセッションが有効であること
  ```fish
  aws sso login
  ```
  （プロファイルを使う場合は `aws sso login --profile <profile名>` とし、
  必要に応じて `set -x AWS_PROFILE <profile名>` を先に実行）

## 1. Backend（AG-UI / FastAPI）を起動

```fish
cd /Users/hiruta/work/slidev-agent
uv run uvicorn slidev_agent.agui_server:app --reload --port 8000
```

- エントリポイント: `src/slidev_agent/agui_server.py`
- 内部で `create_slidev_agent()`（CLIと同じ単一Agent経路）を `ag_ui_strands.StrandsAgent` でラップし、
  `create_strands_app()` でFastAPI化している
- **マルチエージェントGraph（`create_slidev_graph`）には未対応**。あくまで単一Agent版の確認用

起動確認:
```fish
curl http://localhost:8000/ping
```

## 2. Slidev dev server（プレビュー用）を起動

別ターミナルで:

```fish
cd /Users/hiruta/work/slidev-agent/output
npx slidev slides.md
```

- `http://localhost:3030` でHMR付きプレビューが起動する
- Frontend（後述）はこのURLを `<iframe>` で埋め込み、`write_slidev_markdown` による書き換えを
  Slidev自身のHMRでリアルタイム反映する

## 3. Frontend（Next.js + CopilotKit）を起動

別ターミナルで:

```fish
cd /Users/hiruta/work/slidev-agent/web
npm install   # package.json/package-lock.jsonに変更がなければ省略可
npm run dev
```

- デフォルトで `http://localhost:3000` で起動
- backend URLは環境変数 `AGENT_URL` で指定可能（未設定時は `http://localhost:8000/` を使用）
  ```fish
  set -x AGENT_URL http://localhost:8000/
  ```
  （`web/app/api/copilotkit/route.ts` 参照）
- プレビューパネルのURLは環境変数 `NEXT_PUBLIC_SLIDEV_URL` で指定可能（未設定時は `http://localhost:3030` を使用）
  （`web/components/SlidevPreview.tsx` 参照。ビルド時に埋め込まれるため変更後は再起動が必要）
- `web/.env.example` を `web/.env.local` にコピーして値を調整できる

起動確認:
```fish
curl -o /dev/null -w '%{http_code}\n' http://localhost:3000/
```
`200` が返ればOK。

## 4. 疎通確認（API Route経由）

ブラウザを開く前に、Next.jsのAPI Route (`/api/copilotkit`) からbackendまでチェーンが通ることを
サーバーログで確認する（`http://localhost:3000` を一度開くだけでも `POST /api/copilotkit` →
`POST /`(backend:8000) の200が両方のログに出るはず）。

```fish
open http://localhost:3000
```

## 5. E2E確認（ブラウザ）

1. `http://localhost:3000` を開く（左: チャット、右: Slidevプレビューの分割レイアウト）
2. チャット欄にスライド生成のトピックを入力（例: 「生成AIの最新動向について3枚のスライドを作って」）
3. 以下がチャットUI上に順に表示されることを確認
   - ツール呼び出しの進捗表示（`web/components/ToolActivity.tsx` が担当）
     - 🔍 Web検索中 → 📄 ページ取得中 → 📝 スライド書き出し中 → 📐 レイアウト検証中
   - 最終的にスライド生成完了のメッセージ
4. `write_slidev_markdown` の書き出し先が Slidev dev server の対象ファイル（`output/slides.md`）と
   一致していれば、右側のプレビューがHMRで自動更新される。更新されない場合はプレビュー右上の
   「再読み込み」ボタンを使う
5. 生成物の実体は `output/` 配下に書き出される（テスト成果物なのでcommit対象に含めないこと）

## 6. バックグラウンド起動・後片付けの注意

- `uv run uvicorn ...`、`npx slidev ...`、`npm run dev` は起動後 `disown` してバックグラウンドに回せる
- セッションを跨ぐと起動プロセスは残らないため、再開時は上記コマンドで再起動すること
- 生存確認は常に以下のコマンドで:
  ```fish
  curl http://localhost:8000/ping
  curl -o /dev/null -w '%{http_code}\n' http://localhost:3030/
  curl -o /dev/null -w '%{http_code}\n' http://localhost:3000/
  ```

## 既知の制約（要注意）

- `create_slidev_graph()`（planner→researcher→writer→validatorのマルチエージェント構成）は
  AG-UI未対応。現状のフロントエンドはCLIと同じ単一Agent経路のみを確認できる
- `web/package.json` に `@copilotkit/react-ui` が未使用のまま残っている（uninstall未実施）
- Bedrock AgentCoreへの `--protocol AGUI` ネイティブデプロイは未検証
  （本番デプロイ導線は `infra/lib/slidev-agent-runtime-stack.ts` にAgentCore Runtimeのみ定義されており、
  frontend自体のデプロイ先はCDK側に未整備）
