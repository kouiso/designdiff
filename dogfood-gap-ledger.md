# Dogfood Gap Ledger

designdiff を実弾で使い倒して踏んだ不満・バグ・改善要望を1行ずつ記録する。
記録 → 汎用化 → `report_issue` で起票 or designdiff 側を即fix。これが dogfood を本質たらしめる装置。

書式: `| 日付 | 面 | 事象(汎用化) | 期待 | 実際 | 状態(todo/issue#/fixed) |`

## Web (sample-corporate / WSL)

| 日付 | 面 | 事象 | 期待 | 実際 | 状態 |
|------|----|------|------|------|------|
| 2026-06-20 | WEB | list_figma_frames に「ページ単位フレームだけ」モードが無い。default は2件しか返さず、しかも本体ページ(最大幅の artboard)を取りこぼして小さい補助フレームを拾う。include_nested:true は409件（Btn/Header/icon の入れ子全部）で溺れ、56件で truncate | デザイナーが比較対象にする数枚のページ artboard が素直に並ぶ | default=2(SP補助フレーム)、nested=409。中間（トップレベルの大判 artboard 一覧）が取れない | #168 |
| 2026-06-20 | WEB | get_design_tokens が TEXT ノードの文字色を property="backgroundColor" で返す（color と判別不能） | TEXT の fill は color、FRAME/RECT は backgroundColor と種別で出し分け | 全ノードの fill を一律 backgroundColor 出力。実装で color/background を取り違える | #170 → fix PR 作成中 |

## Flutter (sample-project / macmini)

| 日付 | 面 | 事象 | 期待 | 実際 | 状態 |
|------|----|------|------|------|------|
| | | | | | |

## React Native (sample-mobile / macmini, NO-PUSH) 

| 日付 | 面 | 事象 | 期待 | 実際 | 状態 |
|------|----|------|------|------|------|
| | | | | | |
