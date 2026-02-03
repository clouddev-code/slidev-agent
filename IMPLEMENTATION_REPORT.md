# Slidev Agent 実装レポート

## 実装概要

仕様書に基づいて、Slidev AgentをStrands Agents + Bedrock AgentCoreで構築しました。

## 実装完了ファイル

### プロジェクト設定
| ファイル | 説明 |
|----------|------|
| `pyproject.toml` | プロジェクト設定・依存関係定義 |
| `agentcore.yaml` | AgentCore Runtimeデプロイ設定 |
| `.env.example` | 環境変数テンプレート |
| `.gitignore` | Git除外設定 |
| `README.md` | プロジェクトドキュメント |

### ソースコード (`src/slidev_agent/`)
| ファイル | 説明 |
|----------|------|
| `__init__.py` | パッケージ初期化 |
| `main.py` | CLIエントリーポイント |
| `agent.py` | Strands Agent設定・実行ロジック |
| `runtime.py` | AgentCore Runtimeハンドラ |
| `tools/__init__.py` | ツールパッケージ初期化 |
| `tools/search.py` | `web_search`, `web_extract` ツール |
| `tools/writer.py` | `write_slidev_markdown` ツール |
| `prompts/__init__.py` | プロンプトパッケージ初期化 |
| `prompts/system.py` | システムプロンプト定義 |

### テスト (`tests/`)
| ファイル | 説明 |
|----------|------|
| `__init__.py` | テストパッケージ初期化 |
| `test_tools.py` | ツール・設定のユニットテスト |

## ツール仕様

### 1. web_search
```python
web_search(
    query: str,           # 検索クエリ（必須）
    max_results: int = 5, # 最大結果数（1-20）
    time_range: str | None = None  # day/week/month/year
) -> dict[str, Any]
```
- Tavily APIを使用したWeb検索
- `advanced`深度で高品質な検索結果を取得

### 2. web_extract
```python
web_extract(
    url: str  # 抽出対象URL（必須）
) -> dict[str, Any]
```
- 指定URLからコンテンツを抽出
- 成功/失敗ステータスを返却

### 3. write_slidev_markdown
```python
write_slidev_markdown(
    slides_content: str,  # スライドコンテンツ（必須）
    output_path: str = "./output/slides.md",
    theme: str = "default",
    title: str = "Presentation"
) -> dict[str, Any]
```
- Slidev形式のMarkdownファイルを生成
- フロントマターを自動追加

## テスト結果

```
tests/test_tools.py::TestWriteSlidevMarkdown::test_write_basic_markdown PASSED
tests/test_tools.py::TestWriteSlidevMarkdown::test_write_creates_directory PASSED
tests/test_tools.py::TestWebSearch::test_web_search_basic PASSED
tests/test_tools.py::TestWebSearch::test_web_search_with_time_range PASSED
tests/test_tools.py::TestWebExtract::test_web_extract_success PASSED
tests/test_tools.py::TestWebExtract::test_web_extract_no_results PASSED
tests/test_tools.py::TestAgentConfig::test_slidev_agent_config_defaults PASSED
tests/test_tools.py::TestAgentConfig::test_slidev_agent_config_custom PASSED
tests/test_tools.py::TestBuildUserPrompt::test_build_user_prompt_japanese PASSED
tests/test_tools.py::TestBuildUserPrompt::test_build_user_prompt_english PASSED

============================== 10 passed ==============================
```

## 使用方法

### CLI実行

```bash
# 依存関係インストール
uv sync

# 環境変数設定
cp .env.example .env
# .envにTAVILY_API_KEYを設定

# 実行
slidev-agent "Amazon Bedrock AgentCoreの概要" --num-slides 12 --theme seriph
```

### AgentCoreデプロイ

```bash
# シークレット登録
aws secretsmanager create-secret \
    --name slidev-agent/TAVILY_API_KEY \
    --secret-string "your-api-key"

# ローカルテスト
agentcore dev

# デプロイ
agentcore launch
```

## 依存パッケージ

| パッケージ | バージョン | 用途 |
|-----------|-----------|------|
| strands-agents | >=0.1.0 | AIエージェントフレームワーク |
| strands-agents-tools | >=0.1.0 | Strandsツール基盤 |
| tavily-python | >=0.5.0 | Web検索API |
| boto3 | >=1.35.0 | AWS SDK |
| pydantic | >=2.0.0 | データバリデーション |
| python-dotenv | >=1.0.0 | 環境変数管理 |
| rich | >=13.0.0 | CLIフォーマット |

## プロジェクト構造

```
slidev-agent/
├── pyproject.toml
├── agentcore.yaml
├── .env.example
├── .gitignore
├── README.md
├── src/
│   └── slidev_agent/
│       ├── __init__.py
│       ├── main.py
│       ├── agent.py
│       ├── runtime.py
│       ├── tools/
│       │   ├── __init__.py
│       │   ├── search.py
│       │   └── writer.py
│       └── prompts/
│           ├── __init__.py
│           └── system.py
├── tests/
│   ├── __init__.py
│   └── test_tools.py
└── output/
    └── .gitkeep
```

## 次のステップ

1. **環境設定**: `.env`ファイルにTavily APIキーを設定
2. **ローカルテスト**: `slidev-agent "テストトピック"`で動作確認
3. **AgentCoreデプロイ**: `agentcore launch`で本番環境へデプロイ
4. **Slidevプレビュー**: `npx slidev output/slides.md`で生成結果確認
