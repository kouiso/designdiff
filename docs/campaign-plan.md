# FigDiff 全件解消キャンペーン — 統合計画書

> 統合元: `~/.devin/plans/plan-34d1cec42c70a667.md`（セッション goal）+ `docs/implementation-plan.md`（本計画）+ `docs/work-status.md`（台帳）
> 詳細な検証ケースは `docs/test-specification.md`（49 ケース）を参照。
> 最終更新: 2026-09-12 / 作業場所: `~/ghq/kouiso/designdiff-wt-dogfood` @ `codex/full-dogfood-resolution`

---

## 0. ゴールと収束条件

**ゴール**: AI がリポジトリ URL だけから導入・比較・原因調査・修正確認まで自律できる状態。desktop は説明書なしで人間が比較完了でき、AI が画面名で案内できる状態。

**収束**: 最終修正を含む**同一 SHA で全機能検証 2 巡連続・新規不具合 0 件**。修正が入ったら巡回リセット。

**ルール**:
- GitHub Issue を閉じたこと・テスト成功・FigDiff 自身の一致率は**動作の証拠にしない**。正解は独立 oracle（原画像・既知座標・DOM 矩形）で判定
- 証跡は `/tmp` に置かず `docs/evidence/` 等へ保存・即 push（/tmp 消失の教訓）
- `--force`・`--no-verify`・`git reset` 禁止。履歴書き換えは `--force-with-lease` + 明示承認
- 既存作業（`rescue/wsl-stash-1` 本 checkout・ユーザー保存データ）は保護

---

## 1. 背景（喪失と再構成）

macmini 再起動で `/private/tmp/figdiff-01a08ee2-implementation` が消失。未 push の 6 コミット + WIP がオブジェクトごと消えたが、**セッションログ 6 本（15MB）に全編集が逐語記録**されており、`~/figdiff-salvage/` の replay ツールで WSL 上に再構成済み。

- 基点: `fe5e389d` → 再構成 10 コミット → `7f742ece` → Vitest4 rebase 済み
- 再構成で欠落していた `list-projects` 拡張は main-checkout→diff→適用の流れをログから回収して復元
- 消えた元コミット → 再現コミット対応: `d7c9e00`→`0605d857` `fc641b5`→`44e14064` `7e9b5fd`→`6a2f5fc3` `8111e1d`→`62f7f146` `b5e3e75`→`50f36406` `9ddef1f`→`cc967ad7`、WIP 4 件は新規コミット `fea0aa64` `04490ef5` `9c97a73e` `7f742ece`

---

## 2. Phase 進捗

| Phase | 内容 | 状態 |
|---|---|---|
| 0 | サルベージ・worktree・再構成・push・build/lint/test 緑 | ✅ 完了（Vitest4 rebase 後の全テスト再検証中） |
| 1 | PR #144・#146 解消 | 🔄 #144 マージ済・#146 dependabot rebase 待ち |
| 2 | 残 Issue 解消（下表） | 🔄 進行中 |
| 3 | test-spec 全 49 ケース・同一 SHA 2 巡 | ⬜ 0 巡完了 |
| 4 | work-status 更新・handoff・完了報告 | ⬜ |

---

## 3. Issue / PR 対応マトリクス

凡例: ✅解消 / 🔧修正コード投入済・実機検証待ち / 🔍検証のみ残 / ⬜未着手 / 🚫承認待ち

| 対象 | タイトル要約 | 再構成コミット | 状態 |
|---|---|---|---|
| PR #144 / #145 | Vitest 4.1.11 coverage 移行 | — | ✅ マージ済（#145 連動クローズ確認要） |
| PR #146 | sharp 0.35.4 (dependabot) | — | 🔄 rebase 後マージ |
| #109 | 同一 source 再比較で証跡が暗黙削除 | `0605d857` | 🔧 再起動後の旧ID・画像読込みを実検証 |
| #114 | list_projects が有効プロジェクトを返さない | `44e14064` | 🔧 実 MCP 経由で検証 |
| #131 | 比較ループが stale 履歴を再利用 | `50f36406`+campaign-key | 🔧 campaign 分離の互換性検証 |
| #119 | 未計測スコアを「0点」赤リング表示 | `50f36406` | 🔧 未計測/測定済みの実画面検証 |
| #113 | 複数 ADB 端末を選べない | `6a2f5fc3` | 🔧 複数端末の選択・撮影・切断検証 |
| #112 | 小さい文字差分が全体 critical 化 | `04490ef5` | 🔧 文字検体で再現確認 |
| #135 | マスク候補でテキスト領域を写真と断定 | `62f7f146` | 🔧 候補説明の文言検証（レビュー済） |
| #136 | Figma 書出し背景欠落を実装差分と区別 | `62f7f146` (figma-export-inspection) | 🔧 再現→検証 |
| #132 #139 #140 | MCP 失敗時の原因・復旧手順・出力スキーマ整合 | `62f7f146`+`9c97a73e` | 🔍 実 SDK/stdio・書込み不可環境で検証 |
| #58 #59 | 採点 bbox ずれ・capture_width 振動 | 既存修正（develop 側） | 🔍 座標検体の反復再現 |
| #137 #138 | 端の位置揃え・比較基準矩形の MCP 出力 | 既存修正 | 🔍 alignment 実動確認 |
| #125 | visible:false frame が白紙レンダー | （一部 figma-export-inspection） | ⬜ 再現→修正 |
| #118 | desktop から呼べない MCP 7 機能 | `fea0aa64`（レポート保存のみ） | 🔄 残 6 機能: ノード詳細/トークン表示/除外領域/修正前後/アニメーション/問題報告 |
| #79 | .claude/settings.json に outputStyle | `cc967ad7` | 🔧 クラウド適用の確認残り |
| #62 #65 | 親 PBI 残トラック | — | 🔍 子課題の証跡照合・残チェック項目 |
| #147 #148 | キャンバスと表示領域の区別（新規） | — | ⬜ 実装（長いキャンバスのモーダル再現） |
| #69 | pink-labo 参照の後始末・履歴書き換え | — | 🚫 最後。隔離コピー・バックアップ・tree 不変・`--force-with-lease`・明示承認要 |

**dogfooding 並行タスク**: MCP（個人スキル非依存の新規 AI が URL のみで自律利用）・desktop（説明書なし比較完了）・新規発見の照合起票。

---

## 4. 検証マトリクス（test-spec 49 ケースの経路）

| 群 | ケース数 | WSL での実施経路 |
|---|---|---|
| C01–C13 比較正確性 | 13 | 独立検体生成（原画像・既知座標・DOM矩形） |
| M01–M16 MCP | 16 | 実 SDK Client + StdioClientTransport → 新規ビルド |
| D01–D10 desktop | 10 | WSLg/xvfb + Linux Electron、実 IPC・mock 禁止 |
| X01–X10 連携 | 10 | Chrome拡張: CDP 9222 共有 Chrome / Figma plugin: 実 Figma / Android: ローカル adb |
| Windows ネイティブ | — | `powershell.exe` interop（WSL 結果と分離記録） |
| macOS 依存 | — | `ssh macmini-lan`（disk 残量少・証跡は /tmp 禁止） |
| iOS/Android 実機 | — | iOS は macmini 経由 or handoff、Android は接続端末で判定 |

環境: Node 25.6.1 / pnpm 9.15.9 / Vitest 4.1.11（#144 マージで移行済）/ `gh` 認証有 / adb 有。

---

## 5. 巡回記録

| 巡回 | 対象 SHA | 新規不具合 | 判定 | 証跡 |
|---|---|---|---|---|
| 1 | 未確定 | 未測定 | NOT RUN | — |
| 2 | 未確定 | 未測定 | NOT RUN | — |

## 6. 保留中の承認・外部依存

- **#69 履歴書き換え**: 実行時に明示承認（計画内・tree 不変検証付き）
- **#146 マージ**: dependabot rebase → CI 緑 → 承認済みなのでマージ可
- **Figma PAT**: 実 API 検証に必要。環境変数/キーチェーン確認、無ければ要所残しで進行
- **macOS disk**: 残約 1.3GiB と少ない。証跡配置に注意
- **実行不能項**: `handoff/windows-wsl-verification.md` へ失敗理由・コマンド・期待値・証跡先を記録（未実行を成功扱いしない）
