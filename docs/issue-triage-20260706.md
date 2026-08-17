# slidev-agent Issue 棚卸しレポート（2026-07-06）

対象: GitHub `clouddev-code/slidev-agent` / 現ブランチ `feature/agentcore-amplify-deployment`

## 0. 前提となるコード実態調査（本日確認）

作業ツリーの未コミット変更を実際に検証した結果、**Issue #5 の記載と実コードに乖離**がある。

| 項目 | Issue #5 上の状態 | 実コードの状態（本日確認） |
|---|---|---|
| Critical-B: signin/page.tsx Hooks違反 | 未完了 | **修正済み（未コミット）** — `useAuthenticator` を子コンポーネント `RedirectAfterSignIn` に分離 |
| High: Bedrock IAM `resources: ['*']` | 未完了 | **修正済み（未コミット）** — `infra/lib/slidev-agent-runtime-stack.ts` で foundation-model + inference-profile ARN に絞り込み |
| High: DynamoDB Streams IAM `*` | 未完了 | **修正済み（未コミット）** — `web/amplify/backend.ts` でストリームARNにスコープ（`ListStreams` のみ仕様上 `*`） |
| Critical-A: Storage 認可不整合 | 未完了 | **未修正** — `storage/resource.ts` / `handler.ts` / `JobProgress.tsx` に変更なし |
| Critical-C: writer invocation_state 未使用 | 未完了 | **未修正** — `src/slidev_agent/agent.py:221` の `_writer_invocation_state` は定義のみで参照ゼロ |
| Critical-D: モデルIDの `:0` suffix 欠落 | 未完了 | **未修正** — `agent.py:59` と `infra/bin/slidev-agent-infra.ts:22` の両方が `us.anthropic.claude-opus-4-6-v1`（`:0` なし） |

さらに: このブランチには **PR が存在せず、上記の修正済み分すら未コミット**。作業成果が消失するリスクが最も差し迫った問題。

---

## 1. 各 Issue の現状評価

### Issue #5: AgentCore Runtime + Amplify Web UI — **有効（最重要・ただし要更新）**
- 本ブランチの実装そのものを追跡する生きた Issue。クローズ不可。
- ただしチェックリストが実態と乖離（B と IAM 2件は実質完了）。**チェックリストの更新が必要**。
- review-loop Round 1（`docs/review-loop-result-20260524-150507.md`）で Critical 3 / Major 27 が検出済みだが Round 2 未実施。Issue #5 に統合して管理すべき。

### Issue #6: AgentCore Payments サブスク検討 — **有効だが時期尚早（バックログ）**
- AgentCore Payments はまだ Preview であり、かつ #5 の本番デプロイ検証（課金対象のプロダクト自体）が未完了。
- 前提となるマルチテナント化・非同期ジョブ基盤（#5 の High 項目）が固まるまで意思決定できない項目が大半。
- クローズは不要（検討ドキュメント `docs/agentcore-payments-subscription-plan.md` と紐付く戦略 Issue として保持）。ただしラベル `discussion` / `backlog` を付け、マイルストーンを「#5 デプロイ検証後」に明示すべき。

### Closed #2 / #4 — 適切にクローズ済み。対応コミットも main に存在（`bcc8dc4`, `e5ad14d`）。アクション不要。

---

## 2. 優先順位付け

| 優先度 | 対象 | 理由 |
|---|---|---|
| **今すぐ着手** | (0) 未コミット修正のコミット & PR 作成（#5 紐付け） | 修正済み Critical-B / IAM 2件が作業ツリーにしか存在しない。消失リスク |
| **今すぐ着手** | (1) #5 Critical-D → C → A の修正 | 全て「起動即失敗」「成果物取得不能」級の本番ブロッカー |
| **次スプリント** | (2) #5 High 群（下記 3.2 の順序で） | リリース前必須だがブロッカーではない |
| **次スプリント** | (3) AgentCore / Amplify 実デプロイ検証 | Critical 完了後でないと検証が無意味 |
| **バックログ** | (4) Issue #6 全体 | Payments GA 待ち + #5 完了が前提 |
| **クローズ推奨** | なし | 陳腐化 Issue はない |

---

## 3. Issue #5 チェックリスト整理と推奨実装順序

### 3.1 Critical（推奨順序: D → C → A → B✓）

1. **D: モデルID `:0` suffix**（工数: 数分）
   - `src/slidev_agent/agent.py:59` と `infra/bin/slidev-agent-infra.ts:22` の 2 箇所を `us.anthropic.claude-opus-4-6-v1:0` に修正。
   - 最小工数で「全呼び出しが ValidationException で失敗」を解消。スモークテストの前提なので最初。
   - 注意: infra 側の IAM ARN 生成（`foundationModelId` の replace）は `:0` を含む ID でも正しく動くか要確認。
2. **C: `_writer_invocation_state` 未接続**（工数: 小）
   - `agent.py` の Graph 実行時に `invocation_state=_writer_invocation_state(config)` を渡す配線を追加。writer が S3 出力先を確実に受け取る経路を確立。
3. **A: Storage 認可不整合**（工数: 中 — 3ファイル横断）
   - チームレビュー推奨の **案A** を採用: `SlideJob` に `identityId` 追加 → S3 キーを `jobs/${identityId}/${jobId}/slides.md` に変更 → `{entity_id}` ルールと一致させる。
   - スキーマ変更を伴うため Critical の中では最後だが、これを直すまで E2E 検証は成立しない。
4. **B: Rules of Hooks 違反** — ✅ 修正済み（コミットのみ必要）。

### 3.2 High（リリース前・推奨順序）

| 順 | 項目 | 状態 / 備考 |
|---|---|---|
| 1 | IAM `*` の ARN 絞り込み | Bedrock / DDB Streams は**修正済み（未コミット）**。残: Lambda→AgentCore Invoke の `*`（review-loop M1） |
| 2 | Dockerfile venv パスズレ | デプロイ検証のブロッカーになるため先行修正 |
| 3 | `_needs_revision` の文字列部分一致 | 品質ループの根幹。structured output（Pydantic）化を推奨 |
| 4 | `reset_on_revisit(True)` で validator 指摘忘れ | 3 と同時に修正（revision コンテキスト受け渡し設計） |
| 5 | `multiagent_node_stream` ツール取りこぼし | 3・4 と同じ agent.py 内。まとめて 1 PR 可 |
| 6 | Amplify.configure() 2重実行 | フロント安定性。単独小 PR |
| 7 | package.json 依存整理 | ビルド時間・脆弱性面。単独小 PR |
| 8 | 同期 SSE 5〜15分 → SQS/Step Functions 分解 | **最大の設計変更**。初回デプロイ検証は現行同期のままで実施し、検証後に着手する段階戦略を推奨（Lambda 15分制限に接触するため本番前には必須） |

### 3.3 デプロイ検証
- Critical A/C/D 修正 + Dockerfile 修正後に AgentCore Runtime 実デプロイ検証 → 成功後 Amplify Hosting 検証、の順。

---

## 4. Issue #6 要決定事項への推奨アクション

| 要決定事項 | 推奨 | 理由 |
|---|---|---|
| コネクタ選定（Stripe Privy 単独 or +Coinbase CDP） | **Stripe 単独で開始** | 暗号資産決済の需要が未検証。Preview 段階で複雑度を増やさない |
| マルチテナント移行タイミング | **Phase 1 完了後・課金導入前** | 課金と同時のテナント分離改修は事故リスクが高い。#5 の IAM/Storage 設計に依存 |
| Free プランの外部購買禁止 | **禁止で確定** | Payments 経由の従量コストを無料枠に開放する理由がない。即決可 |
| メータード vs 完全定額 | **定額 + 生成回数上限（ハイブリッド）で開始** | メータードは計測基盤（ジョブ単位のコスト計測）が必要で #5 の非同期化後でないと実装不能 |
| 多通貨対応（JPY） | **Phase 2 に前倒し** | 国内ユーザー基盤（作者含む）を考えると JPY は早期に必要。Stripe 側の対応は軽微 |
| AgentCore Payments GA 待ち戦略 | **GA まで Stripe Billing 単層で実装、Payments は追って統合** | Preview API へのロックインを回避。2層構成の「外側」だけ先行 |

→ 即決可能な 2 項目（Free 購買禁止 / GA 待ち戦略）は Issue #6 にコメントで決定として記録し、チェックを付けることを推奨。

---

## 5. 不足している Issue の提案（新規起票推奨）

1. **[bug] review-loop Round 1 指摘の Major 27件のトラッキング**
   — #5 本文には未反映の指摘（`Math.random()` セッションID、パストラバーサル、Docker root 実行、署名URLリフレッシュ等）が `docs/review-loop-result-20260524-150507.md` にのみ存在。セキュリティ系 Major（M1/M2/M3）は独立 Issue 化して見失わないようにする。
2. **[chore] feature ブランチの PR 作成とレビュー完了条件の定義**
   — 39ファイル/+2835行の変更が PR なしで存在。review-loop の残ラウンド（Round 2〜）を PR 上で回す運用に載せる。
3. **[feat] 長時間ジョブの非同期化（SQS or Step Functions）**
   — #5 の High に埋もれているが設計変更規模が大きく、独立 Issue + 設計ドキュメントが妥当。
4. **[chore] CI パイプライン整備**
   — lint / pytest / cdk synth / Next.js build を PR 時に自動実行する仕組みが見当たらない。今回のような「Issue と実コードの乖離」の再発防止に有効。
5. **[docs] ルート README の復旧**
   — 作業ツリーで `README.md` がルートから削除され `docs/README.md` へ移動している。GitHub のリポジトリトップが空になるため、ルートに概要 README を残す判断を明確化する Issue（または即修正）。

---

## 6. サマリー（次の一手）

1. 未コミット修正（Critical-B + IAM 2件 + docs 移動）をコミットし、#5 に紐付く Draft PR を作成
2. Critical-D（`:0` suffix、2行修正）→ Critical-C（invocation_state 配線）→ Critical-A（Storage 認可、案A）
3. Dockerfile 修正 → AgentCore 実デプロイ検証 → Amplify 検証
4. #5 のチェックリストを本レポートの実態に合わせて更新、Major 27件から セキュリティ系を独立 Issue 化
5. #6 はバックログ化し、即決可能な 2 項目のみ決定を記録
