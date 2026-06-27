# Dogfood Gap Ledger

designdiff を実弾で使い倒して踏んだ不満・バグ・改善要望を1行ずつ記録する。
記録 → 汎用化 → `report_issue` で起票 or designdiff 側を即fix。これが dogfood を本質たらしめる装置。

書式: `| 日付 | 面 | 事象(汎用化) | 期待 | 実際 | 状態(todo/issue#/fixed) |`

## Web (sample-corporate / WSL)

| 日付 | 面 | 事象 | 期待 | 実際 | 状態 |
|------|----|------|------|------|------|
| 2026-06-20 | WEB | list_figma_frames に「ページ単位フレームだけ」モードが無い。default は2件しか返さず、しかも本体ページ(最大幅の artboard)を取りこぼして小さい補助フレームを拾う。include_nested:true は409件（Btn/Header/icon の入れ子全部）で溺れ、56件で truncate | デザイナーが比較対象にする数枚のページ artboard が素直に並ぶ | default=2(SP補助フレーム)、nested=409。中間（トップレベルの大判 artboard 一覧）が取れない | #168 |
| 2026-06-20 | WEB | get_design_tokens が TEXT ノードの文字色を property="backgroundColor" で返す（color と判別不能） | TEXT の fill は color、FRAME/RECT は backgroundColor と種別で出し分け | 全ノードの fill を一律 backgroundColor 出力。実装で color/background を取り違える | ✅ fixed #171 (closes #170) |

## Round 1 gap狩り（ワークフロー並列probe＋敵対検証 2026-06-20）

7ツール系統を実Figmaに当てて並列probe → 各gapを懐疑エージェントでrefute。**32候補→27確定（全fix可能, high11/med11/low5）**。

### ✅ 本体fix済み（merge済み）
| 範囲 | 件数 | PR |
|------|------|----|
| get_design_tokens 完全化（border/影/opacity/グラデ/letterSpacing/textAlign/per-corner radius） | 5 | #174 |
| compare_design 堅牢化（perfect-match clamp / エラーUX / screenshot任意化 / figma判定 等） | 8 | #175 |
| inspect_node（dash形式node-id / figma_url node-id / flex CSS / not-foundエラー） | 4 | #176 |
| list_figma_frames ページartboard探索 | 1 | #172 (closes #168) |
| get_design_tokens TEXT文字色→color | 1 | #171 (closes #170) |

### 📝 issue化（med/low・後追い対応）
| 範囲 | 件数 | issue |
|------|------|-------|
| crop/regions 座標系・未登録project_id警告 / report_issue gh fallback / project削除tool / frames pagination・パス漏れ | 6 | #173 |

### dedup（コード修正不要）
- compare_design の「stale dist が visualReview を残して落ちる」3件 → `package/shared/dist` は **.gitignore**。CIは `pnpm build` で再生成され緑。ビルド鮮度問題でリポ欠陥ではない。

### 既知の制約（正直記録）
- 本セッションの figdiff MCP サーバーは起動時の旧コードを保持。今回の本体fixは **live 再呼び出しには未反映**（サーバー再起動が必要）。検証は各PRの CI unit テストが正。

## Round 2（自己コードの敵対回帰レビュー）
merge済み9 PRのコードを読み、回帰/潜在バグを並列adversarialレビュー → **18候補→17確定**（med8/low9）。
- 全17件を5バッチで fix・merge：figma-url-parser回帰(#178) / token・css調和(#179) / inspect-node budget(#180) / verify-fix信号(#181) / screenshot優先順位(#182)
- 自己検出した #175 のローカルパス誤拒否regressionもここで修正

## Round 3 収束レビュー → Round 4
Round3の17 fixに新regressionが無いか strict 敵対レビュー → **3候補→2確定**：
- [high] verify_fix の colorDelta 閾値 0.01 が 0..100 ΔE スケールに対し小さすぎ（改善を regressed 誤判定）→ 3 に是正
- [med] inspect_node css-suggestion の paint opacity 二重適用 → 一回に
- 2件を Round4 で fix・merge（#183）

## 収束（loop-until-dry）
Round4の2 fixを最終敵対レビュー → **CONVERGED：新規 high/med regression ゼロ**（確信度93% コード解析）。
gap収束推移：27 → 17 → 2 → 0。停止条件到達（gap dry ＋ in-flight PR 全merge ＋ mobile境界記録）。

### このセッションのdesigndiff品質向上サマリ
- マージ 16 PR（回収 B/E/D ＋ 台帳 ＋ dogfood本体fix 多数）
- dogfoodで designdiff の MCP ツール（list_figma_frames / get_design_tokens / inspect_node / compare_design / verify_fix）を実弾で叩いて、欠落・誤ラベル・誤判定・回帰を多数 fix
- 残 med/low 6件は #173 に記録（後追い）

## Mobile（Flutter/RN）— 実機round-trip 完了 ✅
macmini 経由（ssh）で実機 dogfood を完遂。bg-MCP 不要で macmini ローカルの codex に委譲。

### Task D 実機E2E（[deferred:macmini] → 解消）
- **Android**：Pixel(2A091FDH300C0J)で sample-project staging 実画面を `adb exec-out screencap -p` で取得（1080×2340）→ `captureDeviceScreenshot({device:"android"})` が ~/.figdiff/cache/capture/ に保存 → `compare_design` を capture_device:"android" で実行成立（FAIL/match 86.53%/8 region）。
- **iOS**：iPhone 17 Pro sim を `xcrun simctl io booted screenshot` で取得（1206×2622）→ ios-sim provider 検証。sample-mobile dev もsimに導入済み。
- → mobile-capture(#166) の android/ios 両 provider が実機/シムで end-to-end 成立。

### 検出モバイルgap 7件 → issue #185
| # | 重 | gap |
|---|----|-----|
|1|high|DPR/物理px不一致（実機物理px vs Figma論理px、preflightが誤critical）|
|2|high|自動frame選択がモバイルで誤る（幅のみrankでLP誤選択、aspect比要）|
|3|med|capture_device向けremediationが的外れ（capture_width=390はscreenshot_url専用）|
|4|med|システムバー/ナビバーのノイズ差分（crop/ignoreプリセット無し）|
|5|med|height/aspect不一致をcontain resizeで吸収し区別不能|
|6|low|runner経路のdiff成果物パスが弱い|
|7|low|build順依存（mcp-server build が credential-store 先要求）|

tractable な #2/#3/#7＋#1のpreflight明確化は本体fix（PR別）。#4/#5 は issue #185 に保持（大きめ機能）。
RN(sample-mobile)は sample-org 他org＝NO-PUSH。比較ステップのみ実施しpushはしない。

## Flutter (sample-project / macmini)

| 日付 | 面 | 事象 | 期待 | 実際 | 状態 |
|------|----|------|------|------|------|
| | | | | | |

## React Native (sample-mobile / macmini, NO-PUSH)
- iOS sim(iPhone 17 Pro)に sample-mobile dev 導入確認。ios-sim provider の `captureDeviceScreenshot` は実機検証済み（Task D iOS経路）。
- sample-mobile固有のFigma比較は NO-PUSH＋Figmaキー不確定のため未実施（モバイルgapはFlutter側で網羅済み）。

## 総合監査＋多段収束（2026-06-20〜21）
全dogfood fixをマージ後、累積差分を多段で敵対監査し収束させた。

| ラウンド | 検出 | 対応 |
|---|---|---|
| WEB R1 gap狩り | 27確定 | 19件fix(#171/#172/#174/#175/#176) |
| 自己回帰 R2 | 17確定 | 全fix(#178-182) |
| 収束 R3 | 2確定 | fix(#183) |
| #173 残gap | 6 | fix(#186) |
| モバイル実機 | 7 | fix(#188/#189/#190/#191) → #185クローズ |
| 総合監査 | 9確定 | fix(#192-195) |
| 監査fix収束 | 2確定 | fix(#196) |
| 最終収束レビュー | **0（dry）** | **CONVERGED** |

- 収束推移: 27 → 17 → 2 → 9 → 2 → **0**
- このセッション計 **28 PR** を develop にマージ。open PR/重大issue ゼロ。
- 残: #197（pre-existing low、記録のみ）、#185-4/5は#189/#190で対応済み。
- 全 fix は各PR CIで build/typecheck/test/check/lint:eslint 緑。各fixバッチに敵対収束レビュー（CONVERGED確認）。

## WS3 収束（2026-06-25）— capture-lp-screenshots runner 本番投入

PR #207（`feat(WS3): sample-corporate Figma 対実装 構造SSIM ランナー`）を develop にマージ。Closes #205。

- 変更: `scripts/eval/capture-lp-screenshots.mjs` に Astro CLI 動的解決（`spawnAstroPreview`）を追加。
  Astro v4/5/6 系を問わず `astro preview` が正常起動する。
- live E2E 証跡: sample-corporate に対し `--self-manifest` モードで実行 → 12枚スクリーンショット + manifest 生成 [CLI確認] ✅

### runner 動作時の摩擦（dogfood gap）

| 日付 | 面 | 事象 | 期待 | 状態 |
|------|----|------|------|------|
| 2026-06-25 | WEB runner | Node 22.11.0 で Astro v6 ビルドが即死（>=22.12.0 が必要） | エラーに upgrade 案内 or README に記載 | todo |
| 2026-06-25 | WEB runner | Corepack pnpm 署名検証エラー（`COREPACK_ENABLE_STRICT=0` で回避） | README に workaround 記載 | todo |

### 最終状態（2026-06-25）

- `gh pr list -R kouiso/designdiff --state open` → **0件**
- `git worktree list` → メイン1本のみ（prunable 5本 + pr207-runner 削除済み）
- dogfood loop 正式クローズ。
