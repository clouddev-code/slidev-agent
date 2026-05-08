# スライドのフレーム枠内検証と自動再生成

## 背景

`slidev-agent` が生成したスライドは、内容を盛り込みすぎて 16:9 のスライド枠から
はみ出す（オーバーフローする）ことがあった。実際に既存の生成物を解析すると、
`output/slides.md` の 13 枚中 7 枚が枠内に収まらない状態だった。

## 実装方針

1. **検証ツール `validate_slides_fit` を追加** — 生成済みの Slidev Markdown を
   解析し、各スライドが枠内に収まる見込みかをヒューリスティクスで判定する。
2. **エージェントの自己訂正ループ** — `write_slidev_markdown` 直後に必ず
   `validate_slides_fit` を呼び、`overflow_count > 0` の場合は該当スライドを
   分割／要約／レイアウト変更で作り直し、再保存 → 再検証を最大 3 回繰り返す。

## 追加ファイル

| ファイル | 役割 |
|---|---|
| `src/slidev_agent/tools/validator.py` | `validate_slides_fit` 本体 |
| `tests/test_tools.py` の `TestValidateSlidesFit` | パーサと判定ロジックの単体テスト |
| `docs/slide-overflow-validation.md` | このドキュメント |

## 変更ファイル

- `src/slidev_agent/tools/__init__.py` — `validate_slides_fit` をエクスポート
- `src/slidev_agent/agent.py` — エージェントの tools リストに追加 + 手順を更新
- `src/slidev_agent/prompts/system.py` — Validation & Self-Correction Phase を追加
- `README.md` — 機能説明とプロジェクト構造を更新

## 検証アルゴリズム

### スライド分割

Slidev のスライド境界は 2 形式あり、両方を扱える必要がある:

1. 単独行の `---`
2. `---\n<key>: <value>\n---` 形式の per-slide frontmatter（境界も兼ねる）

`_parse_slides()` では、まず ドキュメント frontmatter を除去し、次に
slide-frontmatter ブロックをセンチネル `<<<SLIDE_FM_N>>>` に置換、続いて単独
`---` 行も `<<<SLIDE_BREAK>>>` に置換してからトークン分割することで、両形式が
連続するケース（`output/slides_sre.md` のように区切りが常に frontmatter で
書かれているケース）も正しく分解できる。

### 行数・行幅の見積り

各スライドについて以下を加算して "row 単位" を算出する:

| 要素 | row 加算 |
|---|---|
| H1 見出し | +2.4 |
| H2 見出し | +1.9 |
| H3 見出し | +1.5 |
| H4-H6 見出し | +1.2 |
| コードブロック内の通常行 | +0.95/行 |
| Mermaid / PlantUML 図 内の行 | +0.6/行 |
| コードフェンス開閉 | +0.5 |
| テーブルの罫線 (`---|---`) | +0.6 |
| テーブルの本体行 | +1.1 |
| 箇条書き / 通常行 | `ceil(visual_width / max_chars)` （CJK は 2 幅） |
| 空行 | +0.4 |

`<!-- ... -->` のプレゼンターノートは事前に除去する。

### レイアウト別の予算 (`LAYOUT_LIMITS`)

| Layout | max_rows | max_chars |
|---|---|---|
| `default` | 22 | 90 |
| `cover` | 12 | 70 |
| `intro` | 14 | 70 |
| `center` | 18 | 80 |
| `section` / `new-section` | 8 | 60 |
| `statement` / `fact` | 10 | 60 |
| `quote` | 14 | 80 |
| `two-cols` | 22 | 45（カラムあたり） |
| `two-cols-header` | 20 | 45 |
| `text-image` / `text-window` | 18 | 50 |
| `presenter` | 14 | 70 |
| `end` | 10 | 70 |

`two-cols` 系では `::right::` で左右を分割し、各カラムの row を別個に評価して
最大値を採用する。

### オーバーフロー判定

```python
overflows = estimated_rows > max_rows or longest_line_chars > max_chars * 1.6
```

すなわち、行数オーバーまたは「実用上 wrap が確実に発生する長行」のいずれかを
NG とする。

## ツール仕様

```python
validate_slides_fit(
    output_path: str = "./output/slides.md",
    slides_content: str | None = None,
) -> dict[str, Any]
```

戻り値の主なフィールド:

- `all_fit: bool` — 全スライドが枠内に収まる見込みかどうか
- `overflow_count: int` — オーバーフロー枚数
- `overflow_slide_indices: list[int]` — 1-based のスライド番号
- `slides[i]`:
  - `slide_index`, `title`, `layout`
  - `estimated_rows`, `max_rows`
  - `longest_line_chars`, `max_chars_per_line`
  - `overflows`, `reasons[]`, `suggestions[]`

## 既存スライドへの判定例

| ファイル | 総スライド | オーバーフロー |
|---|---|---|
| `output/slides.md` | 13 | 7 |
| `output/slides_sre.md` | 10 | 2 |
| `output/slides_agentteams.md` | 11 | 0 |

`slides.md` で典型的に NG だったのは、大型コードブロックを 1 枚に詰め込んだ
「セットアップ手順」「SDK によるクライアント構築」「GitHub Actions 活用例」
などのスライド。`suggestions` には「2 枚以上に分割」「two-cols 化」などが
返り、エージェントはこれを見て再生成する。

## エージェントの自己訂正フロー

`SYSTEM_PROMPT` の `### 4. Validation & Self-Correction Phase` および
`build_user_prompt` の手順 5–7 で以下を必須化した:

1. `write_slidev_markdown` で保存
2. `validate_slides_fit` を実行
3. `all_fit == true` なら完了
4. そうでなければ `overflow_slide_indices` の各スライドを `suggestions` に
   従って書き直し、`write_slidev_markdown` で上書き
5. 2 へ戻る（最大 3 回）

3 回でも残る場合は「1 アイデア = 1 スライド」の積極分割を優先するよう指示。

## テスト

`tests/test_tools.py::TestValidateSlidesFit` で以下を検証:

- 単純なドキュメントのスライド分割（frontmatter 有無の混在）
- 短いスライドが OK 判定になる
- 行数の多いスライドが overflow 判定になり `suggestions` が返る
- `new-section` などの厳しい予算が機能する
- `two-cols` がカラム単位で評価される
- プレゼンターノート (`<!-- -->`) が計算から除外される
- ファイルからの検証 / 存在しないファイルのエラー処理
- 大きなコードブロックが reason に含まれる

`uv run pytest tests/test_tools.py` で 19 件すべて pass。

## 限界と今後の改善

- ヒューリスティクス判定なので、特殊なテーマ／カスタム CSS／フォント変更には
  追従できない。より厳密に判定したい場合は Playwright で実際にレンダリングして
  オーバーフロー領域を取得する `validate_slides_fit_browser` の追加が考えられる。
- 現状は `default` テーマ前提のしきい値。`penguin` 等テーマ別のキャリブレーションは
  運用しながら調整する。
