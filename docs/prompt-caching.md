# Prompt caching

`src/slidev_agent/agent.py` の `create_model()` が返す Claude 系のモデルで、プロンプトキャッシュを有効にしています。設定は `PROMPT_CACHE_CONFIG = CacheConfig(strategy="auto", tools_ttl=True)` で、Strands 1.57 以降の `CacheConfig` を使っています。

| Provider | キャッシュの位置 | 備考 |
| --- | --- | --- |
| `anthropic`（Claude API） | system・tools の末尾・最後の user メッセージ（`cache_control: ephemeral`） | |
| `bedrock` | system・toolConfig・最後の user メッセージ（`cachePoint`） | `auto` のため、モデル ID に `claude` / `anthropic` を含む場合だけ有効 |
| `vertexai`（Gemini） | 設定なし | Gemini は暗黙キャッシュに任せる |

- TTL は既定値（5 分）です。各ノードのツール呼び出しの繰り返しと、writer と validator の間の書き直しが 5 分以内に続くので、既定値で足ります。
- 最小トークン数に届かない部分はキャッシュされません。システムプロンプトだけでは届かず、ツール結果が積み上がった会話履歴の部分でキャッシュが効きます。
- 動作の確認: Runtime のログ、または `AgentResult.metrics` の `cacheReadInputTokens` と `cacheWriteInputTokens` を見ます。
- テスト: `tests/test_agent.py`。リクエストにキャッシュの指定が入ることを確認します。
