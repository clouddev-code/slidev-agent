# Tavily API 調査レポート

## 1. Tavily APIとは何か

Tavily APIは、**LLM（大規模言語モデル）向けに最適化された検索エンジンAPI**です。AIエージェントやRAG（Retrieval-Augmented Generation）アプリケーションに、正確で効率的なリアルタイムWeb検索機能を提供します。

### 主な特徴

- **LLM最適化**: AIモデルが事実に基づいた推論を行えるよう、構造化されたデータを返却
- **リアルタイム検索**: 最新のWeb情報を取得
- **コンテンツ抽出**: 関連性の高いコンテンツを抽出し、モデルが処理しやすい形式で提供
- **ハルシネーション防止**: AIが誤った情報を生成するリスクを軽減

### 提供されるAPI機能

| 機能 | 説明 |
|------|------|
| **Search** | Web検索 |
| **Extract** | URLからコンテンツを抽出 |
| **Crawl** | Webクローリング（招待制） |
| **Map** | サイトマッピング |
| **Research** | 包括的なリサーチレポート生成 |

### 料金体系

- **無料枠**: 月1,000クレジット（クレジットカード不要）
- **basic検索**: 1クレジット/リクエスト
- **advanced検索**: 2クレジット/リクエスト

---

## 2. Python SDKのインストール方法

### インストール

```bash
pip install tavily-python
```

### アップデート

```bash
pip install --upgrade tavily-python
```

### 必要な依存関係

特別な依存関係の設定は不要で、`pip install`で必要なパッケージが自動的にインストールされます。

---

## 3. 検索APIの使い方（search）

### 基本的な使い方

```python
from tavily import TavilyClient

# クライアントの初期化
tavily_client = TavilyClient(api_key="tvly-YOUR_API_KEY")

# 基本的な検索
response = tavily_client.search("Who is Leo Messi?")
print(response)
```

### Q&A検索（簡潔な回答を取得）

```python
from tavily import TavilyClient

tavily_client = TavilyClient(api_key="tvly-YOUR_API_KEY")
answer = tavily_client.qna_search(query="Who is Leo Messi?")
print(answer)
```

### RAG向けコンテキスト取得

```python
context = tavily_client.get_search_context(query="...")
```

### 検索パラメータ

| パラメータ | 型 | 説明 | デフォルト |
|-----------|-----|------|-----------|
| `query` | string | 検索クエリ（**必須**） | - |
| `search_depth` | string | 検索の深さ（後述） | `basic` |
| `max_results` | int | 結果数（0-20） | 5 |
| `topic` | string | `general` または `news` | `general` |
| `time_range` | string | `day`/`week`/`month`/`year` | - |
| `start_date` | string | 開始日（YYYY-MM-DD形式） | - |
| `end_date` | string | 終了日（YYYY-MM-DD形式） | - |
| `include_domains` | list | 対象ドメイン（最大300） | - |
| `exclude_domains` | list | 除外ドメイン（最大150） | - |
| `country` | string | 国別ブースト | - |
| `include_answer` | bool/string | LLM生成回答を含む | - |
| `include_raw_content` | bool | 生コンテンツを含む | - |
| `include_images` | bool | 画像を含む | - |
| `include_favicon` | bool | ファビコンを含む | - |
| `auto_parameters` | bool | 自動パラメータ最適化 | - |
| `chunks_per_source` | int | ソースあたりのチャンク数（1-3、advancedのみ） | - |

### search_depth オプション

| オプション | クレジット | 特徴 |
|-----------|----------|------|
| `advanced` | 2 | 最高の関連性、複数のスニペット/URL |
| `basic` | 1 | バランス型、1つのNLP要約/URL |
| `fast` | 1 | 低レイテンシ優先 |
| `ultra-fast` | 1 | 最小レイテンシ |

### 詳細な検索例

```python
from tavily import TavilyClient

tavily_client = TavilyClient(api_key="tvly-YOUR_API_KEY")

response = tavily_client.search(
    query="latest AI developments",
    search_depth="advanced",
    max_results=10,
    topic="general",
    include_answer=True,
    include_images=True,
    time_range="week"
)
```

### cURLでの直接API呼び出し

```bash
curl -X POST https://api.tavily.com/search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer tvly-YOUR_API_KEY" \
  -d '{"query": "Your search query"}'
```

---

## 4. レスポンスの形式

### レスポンススキーマ

```json
{
  "query": "検索に使用したクエリ",
  "answer": "LLM生成の回答（リクエストした場合）",
  "results": [
    {
      "title": "ページタイトル",
      "url": "ソースURL",
      "content": "要約スニペット",
      "score": 0.81,
      "favicon": "ファビコンURL（リクエストした場合）"
    }
  ],
  "images": [],
  "response_time": 1.67,
  "usage": {
    "credits": 1
  },
  "request_id": "一意の識別子"
}
```

### レスポンスフィールドの説明

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `query` | string | 実行された検索クエリ |
| `answer` | string | LLMが生成した回答（`include_answer`がtrueの場合） |
| `results` | array | 検索結果の配列 |
| `results[].title` | string | ページのタイトル |
| `results[].url` | string | ページのURL |
| `results[].content` | string | コンテンツの要約/スニペット |
| `results[].score` | float | 関連性スコア（0-1） |
| `results[].favicon` | string | ファビコンのURL |
| `images` | array | 画像検索結果（`include_images`がtrueの場合） |
| `response_time` | float | レスポンス時間（秒） |
| `usage` | object | 使用クレジット情報 |
| `request_id` | string | リクエストの一意識別子 |

### HTTPステータスコード

| コード | 説明 |
|--------|------|
| 200 | 検索成功 |
| 400 | 無効なパラメータ |
| 401 | 認証エラー |
| 429 | レート制限超過 |
| 432/433 | 使用制限超過 |
| 500 | サーバーエラー |

---

## 5. APIキーの設定方法

### APIキーの取得

1. [Tavily公式サイト](https://www.tavily.com/)にアクセス
2. アカウントを作成（無料）
3. [ダッシュボード](https://app.tavily.com/home)からAPIキーを取得

### 設定方法

#### 方法1: 直接指定（開発/テスト用）

```python
from tavily import TavilyClient

tavily_client = TavilyClient(api_key="tvly-YOUR_API_KEY")
```

#### 方法2: 環境変数を使用（推奨）

**ターミナルで設定:**
```bash
export TAVILY_API_KEY="tvly-YOUR_API_KEY"
```

**Pythonコードで使用:**
```python
import os
from tavily import TavilyClient

api_key = os.getenv("TAVILY_API_KEY")
tavily_client = TavilyClient(api_key=api_key)
```

**注意**: `TavilyClient`は環境変数`TAVILY_API_KEY`を自動的に読み込む機能もあります。

#### 方法3: .envファイルを使用

`.env`ファイル:
```
TAVILY_API_KEY=tvly-YOUR_API_KEY
```

Pythonコード（python-dotenvを使用）:
```python
from dotenv import load_dotenv
import os
from tavily import TavilyClient

load_dotenv()
tavily_client = TavilyClient(api_key=os.getenv("TAVILY_API_KEY"))
```

#### 方法4: Docker Compose

```yaml
services:
  app:
    environment:
      - TAVILY_API_KEY=${TAVILY_API_KEY}
```

### APIキー管理のベストプラクティス

1. **ソースコードにハードコードしない**: 環境変数またはシークレット管理ツールを使用
2. **定期的なローテーション**: 約3ヶ月ごとにキーを更新
3. **キーが漏洩した場合**:
   - 即座にダッシュボードでキーを削除/無効化
   - 新しいキーを生成
   - アプリケーションの認証情報を更新

### 安全なキーローテーション手順

1. 新しいキーを生成（古いキーは有効なまま）
2. アプリケーションコードを新しいキーで更新
3. 新しいキーが正常に動作することを確認
4. 古いキーを削除

---

## その他の機能

### コンテンツ抽出（Extract）

```python
response = tavily_client.extract("https://en.wikipedia.org/wiki/Lionel_Messi")
print(response)

# 複数URLの同時抽出（最大20件）
response = tavily_client.extract(
    urls=["url1", "url2", "url3"],
    include_images=True
)
```

### スマートクローリング（Crawl）- 招待制

```python
response = tavily_client.crawl(
    "https://docs.tavily.com",
    instructions="Find all pages on the Python SDK",
    max_depth=3,
    limit=50
)
```

### サイトマッピング（Map）

```python
response = tavily_client.map(
    url="https://example.com",
    max_depth=2,
    limit=30,
    instructions="..."
)
```

### リサーチ（Research）

```python
response = tavily_client.research(
    input="Research topic",
    model="pro",
    citation_format="apa",
    stream=True  # ストリーミング対応
)
```

---

## 参考リンク

- [Tavily公式ドキュメント](https://docs.tavily.com/)
- [Tavily Python SDK - GitHub](https://github.com/tavily-ai/tavily-python)
- [Tavily Python SDK - PyPI](https://pypi.org/project/tavily-python/)
- [Search API リファレンス](https://docs.tavily.com/documentation/api-reference/endpoint/search)
- [Python SDK クイックスタート](https://docs.tavily.com/sdk/python/quick-start)
- [APIキー管理のベストプラクティス](https://docs.tavily.com/documentation/best-practices/api-key-management)
- [Getting Started with the Tavily Search API（ブログ）](https://blog.tavily.com/getting-started-with-the-tavily-search-api/)
