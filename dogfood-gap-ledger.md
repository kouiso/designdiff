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

## Mobile（Flutter/RN）— 唯一の未完了境界
- 委譲経路（bg-MCP）が本セッション未接続、Cloud は実機に届かず。**未着手・境界として保留**。
- 必要なもの：bg-MCP 接続 or macmini 対話セッション（Pixel実機/iOS sim）。
- Task D の mobile-capture パッケージは merge 済み（#166）なので、配線は完了。実機 round-trip だけが残る。

## Flutter (sample-project / macmini)

| 日付 | 面 | 事象 | 期待 | 実際 | 状態 |
|------|----|------|------|------|------|
| | | | | | |

## React Native (sample-mobile / macmini, NO-PUSH) 

| 日付 | 面 | 事象 | 期待 | 実際 | 状態 |
|------|----|------|------|------|------|
| | | | | | |
