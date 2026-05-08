# Claude Opus 4.6 対応

## 概要

Claude Opus 4.6のリリースに伴い、デフォルトモデルIDを更新しました。

## 変更内容

### ブランチ

- **ブランチ名**: `feature/update-opus-4-6`
- **ベースブランチ**: `feature/initial-implementation`

### 変更ファイル

| ファイル | 変更内容 |
|---------|---------|
| `src/slidev_agent/agent.py` | デフォルトモデルIDを更新 |
| `src/slidev_agent/runtime.py` | デフォルトモデルIDを更新 |

### 変更詳細

**旧モデルID**:
```
us.anthropic.claude-sonnet-4-5-20250929-v1:0
```

**新モデルID**:
```
us.anthropic.claude-opus-4-6-v1:0
```

## コミット

```
27f7af9 chore: Update default model to Claude Opus 4.6
```

## 備考

- 環境変数 `BEDROCK_MODEL_ID` で引き続きモデルを上書き可能です
- AWS Region のデフォルトは `us-east-1` のままです
