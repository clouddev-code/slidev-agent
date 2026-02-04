# Claude Sonnet 5 対応準備

## 概要

Claude Sonnet 5のリリースに向けて、モデルIDの更新準備を行いました。

- **ブランチ名**: `feature/claude-sonnet-5-preparation`
- **新しいモデルID**: `us.anthropic.claude-sonnet-5-20260203-v1:0`
- **旧モデルID**: `us.anthropic.claude-sonnet-4-5-20250929-v1:0`

## 変更ファイル

### 1. `.env.example`

環境変数テンプレートファイルのデフォルト値を更新しました。

```diff
- BEDROCK_MODEL_ID=us.anthropic.claude-sonnet-4-5-20250929-v1:0
+ BEDROCK_MODEL_ID=us.anthropic.claude-sonnet-5-20260203-v1:0
```

### 2. `agentcore.yaml`

AgentCore デプロイメント設定ファイルの環境変数を更新しました。

```diff
environment:
  TAVILY_API_KEY: "{{secrets.TAVILY_API_KEY}}"
- BEDROCK_MODEL_ID: "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
+ BEDROCK_MODEL_ID: "us.anthropic.claude-sonnet-5-20260203-v1:0"
  AWS_REGION: "us-east-1"
```

### 3. `src/slidev_agent/runtime.py`

ランタイムのデフォルトモデルID値を更新しました。

```diff
def create_agent() -> Agent:
    """Create the Slidev agent for AgentCore Runtime."""
    model_id = os.getenv(
-       "BEDROCK_MODEL_ID", "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
+       "BEDROCK_MODEL_ID", "us.anthropic.claude-sonnet-5-20260203-v1:0"
    )
```

## 後方互換性

`BEDROCK_MODEL_ID` 環境変数を使用しているため、以下の方法で旧モデルへのフォールバックが可能です：

```bash
# 旧モデルを使用する場合
export BEDROCK_MODEL_ID=us.anthropic.claude-sonnet-4-5-20250929-v1:0
```

## リリース手順

Sonnet 5 がリリースされた後:

1. Bedrock でモデルアクセスが有効になっていることを確認
2. このブランチを `main` にマージ
3. AgentCore を再デプロイ

```bash
git checkout main
git merge feature/claude-sonnet-5-preparation
agentcore launch
```

## 備考

- モデルIDのフォーマット: `us.anthropic.claude-sonnet-5-20260203-v1:0`
  - `us.` - US リージョンプレフィックス（クロスリージョン推論用）
  - `anthropic.claude-sonnet-5` - モデルファミリー
  - `20260203` - バージョン日付
  - `v1:0` - バージョン番号
