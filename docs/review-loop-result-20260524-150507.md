# review-loop Round 1 結果 — Issue #5

- **対象**: feature/agentcore-amplify-deployment ブランチ (vs origin/main)
- **diff 規模**: 39 files, +2835/-269 行
- **focus**: quality, cdk
- **max_rounds**: 5
- **Issue**: https://github.com/clouddev-code/slidev-agent/issues/5
- **コメント**: https://github.com/clouddev-code/slidev-agent/issues/5#issuecomment-4527560944
- **実行日**: 2026-05-24

## 検出数サマリ

| Severity | 件数 |
|----------|------|
| 🔴 Critical | 3 |
| 🟠 Major | 27 |
| 🟡 Minor | 12 |
| 🔵 Nit | 4 |
| **合計** | **46** |

## レビュアー内訳

| Agent | 観点 | findings |
|-------|------|----------|
| `cdk-code-reviewer` | CDK / Docker / Amplify backend | 21 |
| `general-purpose` (quality) | Python / Next.js / React | 25 |

## Critical 詳細

### C1. Bedrock InvokeModel が `resources: ['*']`
- `infra/lib/slidev-agent-runtime-stack.ts:69`
- 全モデル・全リージョンへの InvokeModel を許可
- 修正: `arn:${partition}:bedrock:${region}::foundation-model/${modelId}` + inference-profile ARN

### C2. DynamoDB Streams 読み取りが `resources: ['*']`
- `web/amplify/backend.ts:28-37`
- 修正: `DynamoEventSource` (L2) に置き換え

### C3. Authenticator render prop 内で `useEffect` 呼び出し
- `web/app/signin/page.tsx:13`
- React Rules of Hooks 違反 → 本番でクラッシュ
- 修正: ページ本体で `useAuthenticator()` 購読

## Major 27件 — 分類

| カテゴリ | 件数 | 代表例 |
|----------|------|--------|
| IAM / セキュリティ | 5 | M1: Lambda→AgentCore Invoke が `*` / M2: `Math.random()` セッション ID / M3: パストラバーサル |
| Docker / IaC | 8 | M6: root 実行 / M7: HEALTHCHECK なし / M8: AgentCore Public Network |
| Python / エージェント | 10 | M14: 例外でスタックトレース消失 / M18: 部分文字列マッチで判定 / M19: Pydantic 検証なし |
| Web / Next.js | 4 | M24: `params` 型 + ID 検証 / M27: 署名 URL リフレッシュなし |

## 次の修正方針

Round 2 で最優先対応すべき項目:

**最優先 (Critical + 重大 Major)**
- [ ] C1, C2, M1: IAM ポリシーの `*` を全廃
- [ ] C3: signin/page.tsx の Hook 違反修正
- [ ] M2: `crypto.randomUUID()` 化
- [ ] M3: writer.py パストラバーサル対策
- [ ] M6, M7: Dockerfile 非 root + HEALTHCHECK
- [ ] M9: non-null assertion 除去
- [ ] M10: LogRetention トークン問題

**次バッチ (Major)**
- [ ] M12: DynamoEventSource + DLQ 移行 (C2 と同時に)
- [ ] M14–M17: Python 例外握り潰し撲滅
- [ ] M18, M19: validator JSON 構造化出力 + Pydantic 検証
- [ ] M20: graph キャンセル処理
- [ ] M21: Bedrock model ID 修正
- [ ] M24: jobs/[id] の ID 検証
- [ ] M27: 署名 URL リフレッシュ

**判断事項**
- 修正規模が 500 行を大きく超えるため、Critical + 重大 Major のみを Round 2 で対応し、残りを Round 3 以降に分割するのが安全。
- M8 (VPC モード) や M23 (Python 3.13 → 3.12) はアーキテクチャ判断が必要なため別途検討。

---

## Round 2 実施結果 (Critical のみ — ユーザー指示)

- **適用ファイル**: 3 files, +30/-11
- **コメント**: https://github.com/clouddev-code/slidev-agent/issues/5#issuecomment-4527567704
- **適用**:
  - C1: Bedrock IAM を foundation-model + inference-profile ARN に絞り込み
  - C2: DynamoDB Streams IAM を `tableStreamArn` に絞り込み (`ListStreams` のみ仕様上 `*` 維持)
  - C3: `RedirectAfterSignIn` 子コンポーネント切り出しで Hooks ルール準拠
- **検証**: ローカルに Node toolchain がないため `tsc --noEmit` 未実行。CI でのビルド検証を推奨。
- **持ち越し**: Major 27 / Minor 12 / Nit 4 (合計 43 件)
- **終了理由**: `user_scoped_converged` (Critical スコープのみ収束、Issue は open のまま)
