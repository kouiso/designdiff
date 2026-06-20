# Dogfood Loop Runbook (continuous-pr / safe)

開始: 2026-06-20 / effort=ultracode / pattern=continuous-pr / mode=safe

## 目的
designdiff を実弾(sample-corporate Figma など)で使い倒し、踏んだ不満を gap 台帳→issue→可能なら本体fix まで回し、designdiff の品質を上げ続ける。

## ループ単位
1. 並列 probe: designdiff の各 MCP ツール系統を実Figmaに当てて gap 候補を収集
2. 敵対検証: 各 gap を懐疑エージェントで refute（仕様か実バグか / repro が本物か）
3. 既出 dedupe（#168 frame粒度 / #170 TEXT fill は対応済み）
4. 確定 gap を issue 化（gh / report_issue）＋ 明確なバグは Codex Cloud で fix→PR→CI緑→merge
5. 台帳 `dogfood-gap-ledger.md` を更新

## 品質ゲート (safe)
- 各 fix PR は CI(ci.yml) 全緑で merge（build/typecheck/test/check/lint:eslint）
- behavioral は merge 前に e2e/unit で観測。done詐称禁止
- 外部 issue は顧客固有のデザイン文脈(URL/node/コピー/会社名)を伏せ、汎用 repro で記述

## 停止条件 (explicit)
- gap 狩りが2ラウンド連続で新規ゼロ（dry）
- かつ in-flight PR が全て merge 済み
- モバイル面(Flutter/RN)は bg-MCP 未接続のため境界として記録し、別経路待ち
- 局長の停止指示

## 状態
- 完了: Task B(#165) / E(#167) / D(#166) / F(ローカル) / Step0トークン / 台帳(#169)
- in-flight: #171(=#170 fix) CI待ち
- issue: #168 未対応(frame粒度), #170 fix中(#171)
- 委譲制約: モバイルdogfood = bg-MCP/macmini 待ち
