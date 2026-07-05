# slidev-agent バックエンド 技術レビュー

公式ドキュメントを根拠に、Critical / High / Medium / Low の4段階で指摘を整理する。
各指摘には「ドキュメントの該当 URL → 現在のコード → 推奨修正」の3点セットを付与する。

---

## Critical

### C-1: `_writer_invocation_state` の戻り値がどこからも使われていない

**ドキュメント**
[Multi-Agent Systems — Shared State](https://strandsagents.com/docs/user-guide/concepts/multi-agent/multi-agent-patterns/index.md#shared-state-across-multi-agent-patterns)

> Both Graph and Swarm patterns support passing shared state to all agents through the `invocation_state` parameter.

Graph を呼び出す際に `graph.stream_async(seed, invocation_state={...})` のようにして渡すか、またはノード実行時のオプションとして注入する必要がある。

**現在のコード**
`agent.py:221–230` で `_writer_invocation_state(config)` が辞書を返すが、`create_slidev_graph` 内でも `runtime.py` でも参照されていない。Writer ノードが `output_path` を確実に受け取る唯一の手段は system_prompt への文字列埋め込み (`_writer_seed_message`) だが、LLM が別の path を選ぶ自由があり、S3 URI を正しく使用する保証がない。

**推奨修正**
`graph.stream_async` に `invocation_state` を渡す。

```python
# runtime.py invoke()
async for event in graph.stream_async(
    seed,
    invocation_state=_writer_invocation_state(config),   # ← 追加
):
```

あわせて、`write_slidev_markdown` / `validate_slides_fit` を `@tool(context=True)` に変更し、`tool_context.invocation_state` から `output_path` を受け取るようにすることで、LLM が path を書き換えるリスクを排除できる。

---

## High

### H-1: `builder.reset_on_revisit(True)` — API 存在確認と挙動の理解

**ドキュメント**
[Graph — GraphBuilder](https://strandsagents.com/docs/user-guide/concepts/multi-agent/graph/index.md#graph-components)

> **reset_on_revisit()**: Control whether nodes reset state when revisited

メソッド自体は公式 API として存在する。ただし writer ノードが「前回 validator から受け取った指摘」の会話履歴をリセットされると、前回の指摘内容が失われ、同じ overflow を繰り返す可能性がある。

**現在のコード**
`agent.py:314` で `builder.reset_on_revisit(True)` を設定している。

**推奨修正**
writer が前の validator 指摘を参照できるよう、`reset_on_revisit(False)` を検討する。あるいは `reset_on_revisit(True)` を維持する場合は、validator の出力を `invocation_state` 経由で次の writer 実行に引き渡すカスタムノードを挟む。

---

### H-2: フィードバックエッジに `else` 分岐がなく、無限ループリスクがある

**ドキュメント**
[Graph — Conditional Edges](https://strandsagents.com/docs/user-guide/concepts/multi-agent/graph/index.md#conditional-edges)

公式サンプルでは `condition=` を付けたエッジを **1本だけ** 定義するだけで、条件が False の場合は「そのエッジを通らない」= グラフが終了する。ただし `add_edge("validator", "writer", condition=_needs_revision)` の他に、`"approved"` の場合の終了エッジが定義されていない。

**現在のコード**
`agent.py:308` で条件付きエッジを1本定義するだけで、`_is_approved` は定義されているが使われていない。条件が `False` なら validator ノードで自然に停止するため、グラフ終了自体は問題ないが、`_needs_revision` の判定が文字列 `"revision needed"` の部分一致に依存している。validator が「revision needed but minor」などのバリエーションを出力した場合は正しく動作するが、LLM が出力形式を変えて `"要修正"` などの日本語を使った場合はループせず暗黙的に承認扱いになる。

**推奨修正**
validator の system_prompt に「英語でかつ `approved` または `revision needed` のいずれかを本文に必ず含めること」と明示し、structured output (Pydantic モデル) を使って LLM 出力を型強制する。または condition 関数に日本語フォールバックパターンを追加する。

```python
def _needs_revision(state) -> bool:
    result = state.results.get("validator")
    if not result:
        return False
    text = str(result.result).lower()
    # 英語 + 日本語フォールバック
    return "revision needed" in text or "要修正" in text or "修正が必要" in text
```

---

### H-3: `multiagent_node_stream` で toolUse / toolResult を取りこぼしている

**ドキュメント**
[Streaming Responses — Tool Events](https://strandsagents.com/docs/user-guide/concepts/streaming/index.md#event-types)

> `multiagent_node_stream`: Forwarded events from agents/multi-agents with node context
> `event`: The original agent event (nested)

ネストされた `event` には `current_tool_use` (ツール呼び出し情報) が含まれる。

**現在のコード**
`runtime.py:107–118` では `inner.get("data")` と `inner["delta"].get("text")` のみを参照しており、ツール呼び出しイベント (`current_tool_use`) を完全に無視している。Lambda 側は progress log としてツール呼び出し状況を受け取れず、デバッグ性が低い。

**推奨修正**
```python
elif etype == "multiagent_node_stream":
    inner = event.get("event", {}) or {}
    text = inner.get("data")
    if not text and isinstance(inner.get("delta"), dict):
        text = inner["delta"].get("text")
    if text:
        yield {
            "type": "node_text",
            "node_id": event.get("node_id"),
            "text": str(text)[:1000],
        }
    # ツール呼び出しも転送する
    tool_use = inner.get("current_tool_use")
    if tool_use and tool_use.get("name"):
        yield {
            "type": "node_tool",
            "node_id": event.get("node_id"),
            "tool_name": tool_use["name"],
        }
```

---

### H-4: Dockerfile の `uv sync --frozen` フォールバックで依存が漏れる

**ドキュメント**
なし (uv 公式動作仕様)

**現在のコード**
`Dockerfile:21`

```dockerfile
RUN uv sync --frozen --no-dev || uv pip install --system .
```

`uv sync --frozen` は `uv.lock` が存在し、コピー元に含まれているときに成功する。`uv.lock*` (glob) でコピーしているため、`uv.lock` が存在しなければ `uv pip install --system .` にフォールバックする。この場合、`uv sync` が作成する `.venv/` ではなく `/usr/local` にインストールされるが、`COPY --from=builder /usr/local/lib/python3.13` でパッケージを引き継ぐため、このパスは正しい。ただし `uv sync --frozen` が成功した場合は `.venv/lib/python3.13/site-packages/` に入り、runtime ステージにコピーされない。

**推奨修正**
フォールバック行を削除し、`uv sync` のみを使うよう統一する。あるいは `uv pip install --system .` を意図的に使うなら、フォールバックではなく最初からそちらを選択する。

```dockerfile
# フォールバック削除: uv.lock を必ずリポジトリに含める運用にする
RUN uv sync --frozen --no-dev
```

または、venv を使わない明示的なオプションを追加する。

```dockerfile
RUN uv pip install --system --no-cache -r pyproject.toml
```

---

## Medium

### M-1: `context.session_id` の属性名は公式ドキュメントに記載がない

**ドキュメント**
[Deploy to Bedrock AgentCore — Observability](https://strandsagents.com/docs/user-guide/deploy/deploy_to_bedrock_agentcore/python/index.md#observability-enablement)

HTTP ヘッダー `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id` がセッション識別子として使われる旨は記載されているが、`context` オブジェクトの公式スキーマは SDK のリファレンスに公開されていない。

**現在のコード**
`runtime.py:49`: `getattr(context, "session_id", None)` で安全に取得しており、`None` の場合は `"local"` にフォールバックするため、実害は小さい。ただし属性が取れない場合、複数の同時ジョブで `job_id` が衝突する可能性がある。

**推奨修正**
`payload["job_id"]` を必須フィールドとして呼び出し側 (Lambda) が必ず付与するよう設計を変更し、`context.session_id` を補助的な fallback に留める。ドキュメントに記載がないため将来的に属性名が変わる可能性をヘッジする。

---

### M-2: `max_node_executions=12` で writer/validator は最大 5 往復

**ドキュメント**
[Graph — GraphBuilder](https://strandsagents.com/docs/user-guide/concepts/multi-agent/graph/index.md#graph-components)

> `set_max_node_executions()`: Limit total node executions (useful for cyclic graphs)

**現在のコード**
`agent.py:312`: `builder.set_max_node_executions(12)` を設定。グラフ全体のノード実行回数の上限。planner(1) + researcher(1) = 2 回消費した後、writer + validator のペアで 1 往復あたり 2 回消費するため、残り 10 回 = 最大 5 往復まで許容される。コメントには「最大3回」とあるが実際は5往復可能。

**推奨修正**
コメントを `agent.py:311` の直前で修正するか、意図通りに3往復に制限する場合は `set_max_node_executions(8)` に変更する。

```python
builder.set_max_node_executions(8)  # planner(1) + researcher(1) + writer/validator×3往復
```

---

### M-3: `_writer_seed_message` を system_prompt に文字列連結している

**ドキュメント**
[Multi-Agent Systems — Shared State](https://strandsagents.com/docs/user-guide/concepts/multi-agent/multi-agent-patterns/index.md#shared-state-across-multi-agent-patterns)

`invocation_state` を使えばランタイムごとに異なるパラメータをプロンプトに埋め込まずに渡せる。

**現在のコード**
`agent.py:282–296`: `create_slidev_graph(config)` を呼ぶたびに `Agent` オブジェクトを再生成するため、ビルド時ではなく実行時に config 別の値が確定する。runtime.py も毎リクエストで `create_slidev_graph(config)` を呼んでいるため（`runtime.py:95`）、現状では1ジョブ1グラフの形になっており機能的には問題ない。ただし `invocation_state` を正しく使えばより疎結合な設計になる。

**推奨修正**
system_prompt からパラメータを取り除き、C-1 で示した `invocation_state` 経由に移行する。

---

### M-4: S3 クライアントをリクエストごとに都度生成している

**現在のコード**
`tools/writer.py:42`: `boto3.client("s3")` を `_write_s3()` 内で毎回生成。  
`tools/validator.py:35`: `boto3.client("s3").get_object(...)` を `_read_markdown()` 内で毎回生成。

AgentCore Runtime はコンテナの起動状態を維持するため、モジュールレベルでクライアントを保持することで接続確立コストを削減できる。

**推奨修正**
```python
# tools/writer.py — モジュール先頭
import boto3 as _boto3
_S3_CLIENT = None

def _get_s3():
    global _S3_CLIENT
    if _S3_CLIENT is None:
        _S3_CLIENT = _boto3.client("s3")
    return _S3_CLIENT
```

または `functools.lru_cache(maxsize=1)` を使う。

---

### M-5: `text[:1000]` + Lambda 側 `[:160]` の二重切り詰め

**現在のコード**
`runtime.py:117`: `str(text)[:1000]` で AgentCore が送出する SSE チャンクを 1000 文字に制限。Lambda 側でさらに `[:160]` に再切り詰めしているとのこと。

AgentCore の SSE ペイロードサイズに上限はドキュメントに明記されていないが、AppSync Mutation の引数長制限が実質的な制約となっている。二重切り詰めは管理が難しく、どちらかに統一すべき。

**推奨修正**
Lambda 側が `[:160]` に制限するなら runtime.py 側の切り詰めは不要。runtime.py を素通しにして責務を Lambda に一本化する。

```python
# runtime.py
"text": str(text),  # 切り詰めなし。Lambda 側に委ねる
```

---

## Low

### L-1: `_CJK_RE` の正規表現で一部の絵文字・記号が欠落

**現在のコード**
`tools/validator.py:301–303`:

```python
_CJK_RE = re.compile(
    r"[　-ヿ㐀-䶿一-鿿豈-﫿＀-￯]"
)
```

Pythonの正規表現では `[　-ヿ]` は `　–ヿ`（全角スペース〜カタカナ）をカバーするが、`ㇰ`〜`ㇿ`（カタカナ拡張）や `ᬀ0`〜`ᬏF`（変体仮名）などが対象外になる。スライドに変体仮名が含まれることは稀なため実用上の影響は小さいが、`unicodedata.east_asian_width()` を使えばより正確に判定できる。

**推奨修正**
```python
import unicodedata

def _visual_width(text: str) -> int:
    """Approximate visual width using Unicode East Asian Width property."""
    return sum(
        2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1
        for ch in text
    )
```

---

### L-2: フロントマター除去の正規表現がコードフェンス内の `---` に誤反応する可能性

**現在のコード**
`tools/validator.py:103–104`:

```python
_DOC_FM_RE = re.compile(r"^---\s*\n.*?\n---\s*\n", flags=re.DOTALL)
_SLIDE_FM_RE = re.compile(
    r"^---\s*\n((?:[A-Za-z][\w-]*\s*:.*\n)+)---\s*\n",
    flags=re.MULTILINE,
)
```

`_DOC_FM_RE` はドキュメント先頭の frontmatter を除去するが、コンテンツ内にコードフェンス (```` ``` ````) で囲まれた `---` が含まれている場合、誤ってスライド境界と判断する可能性がある。`_SLIDE_FM_RE` は `key: value` 形式の行を要求するため誤反応しにくいが、コードブロック内に偶然 `key: val` 形式のコードが並んだ際にリスクがある。

**推奨修正**
改行境界と `---` の組み合わせを判定する前に、コードフェンスのスコープを先に処理するパーサーを段階的に適用する。または既存の Slidev パーサーライブラリを使用する。現状の使用シナリオでは低リスクだが、コードスライドが多いデッキでは誤検知に注意する。

---

## 参考リンク

- [Strands Agents — Graph](https://strandsagents.com/docs/user-guide/concepts/multi-agent/graph/index.md)
- [Strands Agents — Graph Loops Example](https://strandsagents.com/docs/examples/python/graph_loops_example/index.md)
- [Strands Agents — Multi-Agent Patterns / Shared State](https://strandsagents.com/docs/user-guide/concepts/multi-agent/multi-agent-patterns/index.md)
- [Strands Agents — Streaming Responses / Event Types](https://strandsagents.com/docs/user-guide/concepts/streaming/index.md)
- [Deploy to Bedrock AgentCore (Python)](https://strandsagents.com/docs/user-guide/deploy/deploy_to_bedrock_agentcore/python/index.md)
- [Amazon Bedrock AgentCore Runtime — 公式ドキュメント](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html)
