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

## Mobile（Flutter/RN）
- 委譲経路（bg-MCP）が本セッション未接続、Cloud は実機に届かず。**未着手・境界として保留**。bg-MCP接続 or macmini対話セッション待ち。

## Flutter (sample-project / macmini)

| 日付 | 面 | 事象 | 期待 | 実際 | 状態 |
|------|----|------|------|------|------|
| | | | | | |

## React Native (sample-mobile / macmini, NO-PUSH) 

| 日付 | 面 | 事象 | 期待 | 実際 | 状態 |
|------|----|------|------|------|------|
| | | | | | |
