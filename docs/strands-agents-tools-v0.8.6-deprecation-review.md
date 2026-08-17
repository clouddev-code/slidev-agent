# strands-agents-tools v0.8.6 非推奨ツールの影響調査

## 結論

**本アプリへの影響なし。** `strands-agents-tools` パッケージ（`strands_tools`）は
`pyproject.toml` に依存として宣言されているが、コードベース内のどこからも
`import strands_tools` されておらず、非推奨となる14ツールはいずれも未使用。

## v0.8.6 で非推奨になったツール

`strands-agents/tools` の v0.8.6 リリース（2026-08-07）で以下14個のツールに
非推奨警告が追加された（動作は維持、v0.9.0でエラーログ化、将来的にリポジトリ
アーカイブに向けた段階的廃止の一環）。

### PR #550: sleep / editor / shell → SDK vended tools へ

| ツール | 移行先 |
|---|---|
| `sleep` | `strands.vended_tools.sleep` |
| `editor` | `strands.vended_tools.file_editor` |
| `shell` | `strands.vended_tools.shell`（旧`bash`からリネーム予定） |

### PR #566: SDKネイティブ機能・MCP・代替なしへ

| ツール | 移行先 | 種別 |
|---|---|---|
| `batch` | 代替不要（`ConcurrentToolExecutor`がSDKデフォルト） | native |
| `think` | モデルのextended thinking設定 | native |
| `current_time` | `ContextInjector` | native |
| `memory` | `MemoryManager` + `BedrockKnowledgeBaseStore` | native |
| `retrieve` | 同上（`writable=False`） | native |
| `calculator` | vended `shell`（`python3 -c` + sympy） | SDK tool |
| `cron` | vended `shell`（`crontab`）または EventBridge Scheduler | SDK tool |
| `environment` | vended `shell`（読み取り専用） | SDK tool |
| `slack` | 公式 Slack MCP server / `slack_bolt` | MCP |
| `diagram` | 代替なし（graphviz/mermaidを直接記述） | none |
| `rss` | 代替なし（`feedparser`を直接使用） | none |

（出典: [strands-agents/tools#566](https://github.com/strands-agents/tools/pull/566),
[strands-agents/tools#550](https://github.com/strands-agents/tools/pull/550)）

## 本アプリでの依存状況

- `pyproject.toml`: `"strands-agents-tools>=0.1.0"` を宣言（実際に `uv.lock` で
  解決されているのは `0.3.0`。v0.8.6 未到達）
- コードベース全体を `strands_tools` / `from strands_tools` で grep → **ヒット0件**
  （`src/`, `tests/`, `docs/`）
- 本アプリのツール（`web_search`, `web_extract`, `write_slidev_markdown`,
  `validate_slides_fit`。 `src/slidev_agent/tools/`）はいずれも `strands` コアの
  `@tool` デコレータで自作されており、`strands_tools` 由来のプリビルドツールは
  一切使用していない
- 非推奨14ツール名（`sleep`, `editor`, `shell`, `batch`, `think`,
  `current_time`, `memory`, `retrieve`, `calculator`, `cron`, `environment`,
  `slack`, `diagram`, `rss`）でも再検索したが、実装コードでの使用は確認されず
  （`environment`のヒットは環境変数に関するdocstring/コメントのみで無関係）

## 推奨アクション

現状は影響ゼロだが、`strands-agents-tools` 自体が未使用の依存であるため、
以下は任意の整理項目として検討可能（今回の調査スコープの結論には影響しない）:

- `pyproject.toml` から未使用の `strands-agents-tools` 依存を削除する
  （将来リポジトリがアーカイブされる方針が明言されているため、なおさら
  不要な依存を持ち続ける理由がない）
- 将来 `strands_tools` の利用を追加する場合は、上記の移行先（SDK vended
  tools / native機能 / MCPサーバー）を新規採用時から使うほうが手戻りがない
