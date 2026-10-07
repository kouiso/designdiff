# 受け入れマトリクス (Issue #242)

全機能の「期待動作 / 合格条件 / 検証手段 / 最新証跡」の対応表。証跡が無い行は未検証として Issue を紐付ける。
最終更新: 2026-10-01 (develop @ PR #253 相当)。

凡例: ✅ 自動テスト/CI で継続検証 / 🟡 手動または定期実行で検証可能 / ❌ 証跡なし (Issue 参照)

## MCP サーバ (`@figdiff/mcp-server`, 18 tools)

| 機能 | 期待動作 | 合格条件 | 検証手段 | 証跡 |
|---|---|---|---|---|
| `create_project` | プロジェクトを登録し Figma URL を保存 | 同ID重複時はエラー (存在 dir 拒否)、作成後 `list_projects` に出る | `create-project.test.ts`, `project-store.test.ts` | ✅ CI |
| `list_projects` / `delete_project` | 一覧返却・削除 | 未存在ID削除はエラー、削除後 `projectExists:false` | `delete-project.test.ts`, `e2e-compare-design.test.ts` | ✅ CI |
| `set_figma_token` | `figd_` トークンを keychain/ファイルに保存 | 不正形式拒否、保存→参照→削除が往復 | `set-figma-token.test.ts`, IPC スモーク | ✅ CI |
| `list_frames` | プロジェクトのフレーム一覧を返す | ツール応答形式・budget 内件数 | `e2e-compare-design.test.ts`, `mcp-response-budget.test.ts` | ✅ CI |
| `inspect_node` | ノードの構造を返す | 指定ノードの transform/children 抽出 | `e2e-compare-design.test.ts`, `mcp-response-budget.test.ts` | ✅ CI |
| `compare_design` | Figma 画像 vs スクショの差分判定 | verdict/diffRegions/bbox が仕様通り、エラー時は構造化エラー | `compare-design.test.ts` 他多数 | ✅ CI |
| `compare_design_batch` | 複数フレームを1回で逐次比較し集約 | 入力順の per-frame verdict、集約件数/共通差分/収束、1件の実行エラーが残りを打ち切らない、`comparisonId` から全レポート取得可 | `compare-design-batch.test.ts`, `batch-compare-service.test.ts` | ✅ CI |
| crop region (`set_/get_`) | 比較領域を固定・往復参照 | `compare_design` が `cropApplied`/`cropSource` を正しく報告 | `e2e-compare-design.test.ts` (往復結合) | ✅ CI |
| ignore regions (`set_/get_/delete_`) | 除外領域の登録・参照・削除 | 除外領域内の差分はカウントされない | `set-ignore-regions.test.ts` 等 | ✅ CI |
| `verify_fix` | 修正後の再比較・改善判定 | before/after の verdict 遷移が正しい | `verify-fix.test.ts` | ✅ CI |
| `compare_animation` | 連番フレームの変化量 | 変化率/フレームごとの差分 | `compare-animation.test.ts` | ✅ CI |
| `get_design_tokens` | トークン差分抽出 | token diff の分類が正しい | `mcp-response-budget.test.ts`, `token-diff-service.test.ts` | ✅ CI |
| `generate_report` | HTML/Markdown レポート生成 | レポートに verdict/領域/画像が含まれる | `generate-report.test.ts` | ✅ CI |
| `report_issue` | 差分を issue として整形 | GitHub 連携モックで送信形式一致 | `report-issue.test.ts` | ✅ CI |
| Gate1 判定精度 | 細線/1px以下のずれを誤FAILしない | 実検体9ノードで FAIL→PASS 是正 | 実検体画像が必要 | ❌ #243 |

## デスクトップアプリ (`@figdiff/desktop`)

| 機能 | 期待動作 | 合格条件 | 検証手段 | 証跡 |
|---|---|---|---|---|
| アプリ起動・ウィンドウ生成 | Electron main が renderer を表示 | window/preload が生きて IPC 可能 | `e2e/electron-ipc-smoke.mjs` | ✅ `electron-smoke` CI (xvfb) |
| プロジェクト CRUD (IPC) | UI 操作が main 側 store と往復 | save→list→load→delete の往復一致 | 同上 + 78 ユニットテスト | ✅ CI |
| トークン保存 (IPC) | 設定画面から keychain へ | `token:save/get/delete` 往復 | 同上 | ✅ CI |
| ローカル画像読込 | 比較用スクショを読む | `file:read-local-image` が画像を返す | 同上 | ✅ CI |
| 各ページ UI (home/project/compare/overlay/setting) | 画面遷移と表示 | renderer レベルで描画・操作可能 | `e2e/desktop-happy-path.spec.ts` (Playwright) | ✅ `e2e` CI |
| 比較フロー UI 全量 (C/D cases) | 実画像で比較→ハイライト | C/D ケース全通過 | `desktop-c-cases.mjs` / `desktop-d-cases.mjs` | 🟡 ローカル実行 (重量で per-PR CI 外) |
| 自動更新 | 新バージョン通知→差替 | 署名付き配布での実機更新 | コード署名が前提 | ❌ #245 |
| リリース配布 | dmg/exe を作って配る | `release.yml` 実行成功 | 初回リリース未実施 | ❌ #244 |

## Chrome 拡張 (`@figdiff/chrome-extension`)

| 機能 | 期待動作 | 合格条件 | 検証手段 | 証跡 |
|---|---|---|---|---|
| 拡張読込・サービスワーカー | MV3 拡張として登録・稼働 | SW 起動、manifest 妥当 | `script/real-chrome-e2e.mjs` | ✅ `chrome-ext-e2e` CI |
| popup UI・オーバーレイ | 差分ハイライトのドラッグ/スクロール/透明度 | overlay 操作が実ブラウザで動く | 同上 (X01/X02) | ✅ CI (evidence artifact) |
| トークン往復 | 設定→保存→参照 | token round-trip | 同上 | ✅ CI |
| 比較経路 (captureVisibleTab) | 実タブキャプチャ→比較 | 権限付き dist での比較完走 | 権限拡張 dist が必要 | ❌ (拡張 dist 未整備) |

## Figma プラグイン (`@figdiff/figma-plugin`)

| 機能 | 期待動作 | 合格条件 | 検証手段 | 証跡 |
|---|---|---|---|---|
| メッセージバス (ui↔code) | 6コマンドの往復・requestId 相関 | 全応答に requestId がエコー、stale 拒否 | `code.test.ts` (85件), `e2e/real-iframe-host.mjs` | ✅ `figma-plugin-e2e` CI |
| メニュー 3コマンド | inspect / export-frame / compare のルーティング | `figma.command` に応じた正しい挙動 | `code.test.ts` | ✅ CI |
| フレーム抽出・正規化 | ノード情報の構造化 | extraction normalizer の入出力一致 | `code.test.ts` | ✅ CI |
| 実 Figma ホスト内実行 | Figma アプリ内でプラグイン動作 | sandbox 内で export→compare 完走 | 実 Figma 環境 + 公開判断が前提 | ❌ #248 (公開判断は人) |

## 共通・基盤

| 機能 | 期待動作 | 合格条件 | 検証手段 | 証跡 |
|---|---|---|---|---|
| 差分コア (pixelmatch+cluster) | 領域クラスタ・bbox・suggestion | 精度・境界・AA 領域の扱い | shared 51 テスト, oracle 自己検証 CI | ✅ CI |
| p50/p95 性能 | 比較が許容時間内 | sp/pc p95<5s, tall p95<15s(暫定) | `script/eval/figdiff-perf-bench.mjs` | 🟡 `docs/evidence/perf-bench.json` (#251) |
| ドキュメント整合 | 実装と doc の一致 | test-strategy/README/CHANGELOG の数字と実態一致 | 定期レビュー + CHANGELOG ルール (AGENTS.md) | 🟡 #250 |

## 未検証・人待ちのまとめ

- **#243** Gate1 誤FAIL 9ノード — horsemanager 実検体画像が必要 (コードだけでは判定器の調整を検証できない)
- **#244** 初回リリース — `release.yml` 初実行とバージョン表記の統一は人の判断
- **#245** コード署名・自動更新 — macOS/Windows 証明書とアカウント
- **#248** Figma Community への公開判断
