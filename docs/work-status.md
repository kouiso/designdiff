# FigDiff 全件解消の作業状況

## 現在地

- 統合計画：`campaign-plan.md`。元計画：`implementation-plan.md`。テスト仕様：`test-specification.md`。
- 作業開始点：`fe5e389d697a9508d202e11c003b0c956fcee859`。
- 作業branch：`codex/campaign-recovery-20260913-004811`。
- 全体完了：未達。2巡の全機能検証：0巡完了。
- 初回開始時の対象：open Issue 22件、PR2件。
- 以下のmacOS環境情報は初回作業時の記録。現在はWSLのdogfood worktreeで復旧中。
- macOSの空き容量不足で一時停止。再確認で約1.3GiBに回復し、容量監視付きで再開した。
- 依存ファイルは元checkoutからAPFSの独立コピーとして再利用。新規checkoutのビルド・実利用確認はこれから行う。

## 再構成時点の対象と完了証拠（履歴）

この表は再構成時点の調査記録。最新の限定検証は末尾を参照し、静的な原因確認や過去の完了記録だけでIssueを解消済みにしない。

| 対象 | 状態 | 次の作業・必要な証拠 |
|---|---|---|
| PR #144 / #145 | 統合済 | #144 MERGED / #145 CLOSEDを2026-09-13再確認 |
| PR #146 | 統合済 | MERGEDを2026-09-13再確認。merge SHAは `40c458e442e52fc2bb4a4c71b3a80403165db432` |
| #132 #139 #140 | 未検証 | 既存修正後の実SDK/stdioで失敗理由と正常出力を検証 |
| #58 #59 | 未検証 | 座標検体と撮影幅の反復再現 |
| #137 #138 | 未検証 | 既存alignment修正と残る比較基準の実動確認 |
| #112 #125 #136 | 未着手 | 文字・背景・非表示フレームを再現 |
| #135 | 修正済・レビュー中 | texture 0.53/0.71の候補説明を検査。写真の断定を除去し利用者判断・未適用を明記。候補抽出と採点は変更なし |
| #109 | 調査済・修正中 | 6件以上で自動削除するコードを確認。全旧IDと画像の再起動後読込みを検証 |
| #114 | 原因確認済 | 指摘されたディレクトリにはlast-used-node.jsonのみでproject.jsonなし。登録案件ではなく比較キャッシュ。別件の保存対象探索不足は修正中 |
| #131 | 未実装 | campaign単位の履歴分離と既存挙動の互換性を検証 |
| #113 | 未着手 | 複数端末の選択・撮影・切断検証 |
| #118 | 未着手 | 人間向け7機能と端末撮影の導線を実装・検証 |
| #119 | 調査済・修正中 | 未計測を0へ変換する箇所を確認。未計測・測定済み双方の実画面検証 |
| #62 #65 | 未完了 | 子課題の証跡を揃え、残チェック項目を1件ずつ確認 |
| #79 | 未着手 | クラウド設定の適用と固定プロンプト実行 |
| #69 | 未着手 | 全統合後に対象参照を再調査、バックアップ・tree不変検証・履歴整理 |
| MCP導入と説明 | 調査済・未修正 | READMEと公開引数・出力・停止条件の食い違いを修正し、初見AIで検証 |
| 共有設計・SOLID | 調査済・未修正 | 比較geometryと採点の共通化、UI/AI adapter分離、跨機能の検体検証 |

## OS別の実利用証跡（最終巡回は未実施）

| OS/経路 | 状態 | 確認範囲 |
|---|---|---|
| macOS arm64 | 基礎ゲート成功・実利用未完 | 最新desktop差分のbuild・型検査・903テスト成功。最終SHAの巡回ではない |
| Windowsネイティブ | 基礎ゲート成功・実利用未完 | 最新desktop差分のbuild・型検査・903テスト成功。最終SHAの巡回ではない |
| Ubuntu/WSL2 | 限定実行成功・全経路未完 | 実SDK/stdio、実Electron main/preload/IPC、Vite webの29 E2Eを人工検体で確認 |
| Android / iOS Simulator / iOS実機 | NOT RUN | 今回の撮影・比較は未実行 |
| Chrome拡張 | 限定実行・検証器修正中 | 実ChromiumのMV3 captureとoverlayを人工検体で確認。比較結果・対象tabのassert不足を追加レビューで検出 |
| Figma plugin | NOT RUN | 今回の実Figmaホスト上の連携は未実行 |

## 巡回記録

| 巡回 | 対象SHA | 新規不具合 | 判定 | 証跡 |
|---|---|---|---|---|
| 1 | 未確定 | 未測定 | NOT RUN | なし |
| 2 | 未確定 | 未測定 | NOT RUN | なし |

各修正について、修正SHA・実行コマンド・結果・保存した証跡を追記する。
GitHubを閉じたこと自体は動作の証拠にしない。

#114の現物は読取り専用で調査。ディレクトリ44件、project.json 12件のうちschema有効11件・無効1件。MCPも有効11件を返した。元Issueの9件は現在の件数ではない。ユーザー保存ファイルは変更していない。

PR144修正SHA：`032d96252683b6a8ac1fe5d5d2509dea53b76f7e`。既存PRブランチへ通常push済み。GitHub Build run34569595528成功、CI run34569595477は確認時実行中。検証記録はPR内 `docs/evidence/pr-144-review-corrections.json`。


## 2026-09-13の実装と限定検証

個人の実行計画と実行環境の保全先はリポジトリ外に保持する。この記録は共有する実装状態と検証範囲だけを扱う。

- 比較条件・任意ノードの幾何変換・除外領域・修正前後・animation判定を共有化し、desktopの画面とMCPへ接続した。Node専用の永続化・GitHub処理はsharedのNode subpathへ分離した。
- SQLiteを使う除外保存の並行書込みと異常終了後の復旧を確認。Windowsと実Electronでも保存・再読込み・削除・再比較を検証した。
- desktopとMCPのproject保存先を同じ優先順へ統一。実Electronでもhomeと各環境変数を別の場所へ指定し、projectと除外設定の保存・再起動・削除が指定先を使うことを確認した。
- 任意Figmaノードの版固定・crop・mask・修正前後を実Electronで確認。対象の独立画素差分800→0と別領域0→1600を検証し、対象改善と全体FAILを区別した。Figma HTTP境界は人工検体で、実Figmaの動作証明ではない。
- 実OS保存ダイアログでJSON・Markdown保存と取消を確認。問題報告は内容確認・編集・破棄までで、実外部投稿は未実行。
- 実SDK/stdioはissue11件・error5件に成功。原画素・矩形・再起動後の保持・権限復旧をassertし、製品の一致率を正解にしない。公開証跡では生応答と整形後のJSONを区別してhashを記録する。
- 全packageの既存coverage基準、check、lint、型検査、テストを確認した。lintには警告が残る。Vite webのE2Eは29件成功で、実Electronや実端末の検証を代替しない。
- Windows起動・ログの6ファイルは `694ec3a4fcf624a5e06ba7b164560e1376aca838` に保存した。残る製品変更は未コミットで、追加レビューによるMCP比較条件とChrome検証器の修正を進めている。上記の基礎ゲートは後続修正を含む最終検証ではない。
- 最終製品SHAは未確定で、49ケース・全必須OS経路の2巡は0巡。実Figma、端末、全実ホスト連携、クラウド設定、親課題の全項目は引き続き未完。

## 2026-09-17の限定検証（dogfood worktree, HEAD 694ec3a + 未コミット差分）

- figma-plugin `ui.test.ts` を requestId 契約へ追従させ、timeout・stale応答棄却・kind不一致・連番の回帰を追加。156 tests pass、typecheck・Biome clean。
- 新規 `app/figma-plugin/e2e/real-iframe-host.mjs` で実 Chromium iframe + 実 dist bundle を検証（r1）。requestId 付き送信、stale requestId 棄却、一致応答受理、実 timer timeout alert、実 canvas 全相違 fixture=0%(4/4px)、build digest 不変、page/console error 0。証跡 `/home/kouiso/figdiff-salvage/campaign-resume-20260917/plugin-iframe-r1/`。実 Figma ホスト上の code.js 連携は未検証。
- `verify-fix.ts` の typecheck 落ち（diffReport の nested narrowing 未伝播）を修正。`pnpm typecheck` 全 package pass、`pnpm test` turbo 10/10 + script tests 59 pass/1 skip。
- Chrome拡張 native-extension-host を現 HEAD で再実行（r1）。独立 raw RGBA oracle 12,800px・bounds(100,100,160,80) が製品 diffPixelCount と一致、capture PNG hash が実 fixture screenshot と一致、activeTab 不変。popupSurface は toolbar action 取得失敗のため extension-origin tab UI fallback（既知の限定）。証跡 `.../chrome-host-r1`。
- MCP 実 SDK/stdio を現 HEAD で再実行。stdio-error r1: 5/5 PASS・protocolErrors 空（M13 入力・認証・EACCES・権限復旧後の再成功）。stdio-issue r1: verificationFailures 空で C01, C02(#137/#138), C03(#58), C10(#112 実Chromium日本語), #147/#148, #114, M09(#109), M11, M14(#131), M15(#59) を確認。証跡 `.../stdio-error-r1.json`, `.../stdio-issue-r1/`。
- これらは local fixture・実 SDK/stdio の限定検証。実 Figma API・外部 network capture・実端末・全 OS 経路・最終 SHA 二巡は引き続き未完。

## 2026-09-17の追加作業（dogfood, 画素比較統一 X08）

- `@figdiff/shared` に `pixel-compare.ts` を新設し、desktop / MCP / Figma plugin の3系統の比較器を一本化。plugin の独自 RGB 距離比較 (`pixelmatchSimple`) と desktop/MCP の直接 `pixelmatch` import を除去し、runtime import は shared のみ。
- pixelmatch v7 の `checkerboard=true` 既定は半透明画素を市松へ blend し、MCP 従来仕様（v5 の白 blend）と結果が変わる回帰を全体テストで検出。shared wrapper 既定を `checkerboard:false` に固定し v5 互換 semantics を全実行面で統一。透過画素の回帰テストを shared に追加。
- 派生修正: `image-compare-service.test.ts` の pixelmatch 呼出 options 期待値に `checkerboard:false` 追加、`tsconfig.css-suggestion-test.json` の include に `verification-context.ts` 追加、lint:arrow で新規 function 宣言10箇所を arrow 化、Biome format 修正。
- 再検証: `pnpm test` turbo 10/10 + script 59 pass/1 skip、`pnpm typecheck` 10/10、`pnpm lint` 9/9（warningのみ）。
- 統一後 semantics で実機 r3 を再実行し全パス: plugin iframe（8 assertions, 実canvas 0%/4px）、native Electron 6本（node-fix, fix-anim, ignore, issue-report, report-export, score）、stdio 2本（issue検証・error検証）。証跡 `.../plugin-iframe-r3`, `.../*-r3`, `.../stdio-*-r3`。
- chrome-extension は scope 制約で独自 pixelmatch 互換 port を保持（checkerboard 省略 = v5 互換、shared 既定と同一 semantics）。
- desktop / mcp-server の `pixelmatch` 依存宣言は残置。テストの `vi.mock("pixelmatch")` が pnpm strict の specifier 解決に依存するため、除去すると mock が壊れる。

## 2026-09-17の追加検証（dogfood, 実Figma API + 残issue確認）

- `app/mcp-server/script/stdio-real-figma-verification.mjs` を新規追加。実 `figma-pat` トークン・実 fileKey で MCP stdio 経由の製品経路を実行。FIGDIFF_HOME は証跡内へ隔離。
- **#125（実Figma検証済）**: `visible:false` の FRAME `9883:7789` (390x692) に対し、実APIは `use_absolute_bounds=true` で 780x1384 の全透明単色ラスタを返す（PILで uniqueColors=1, transparentRatio=1.0 を独立確認）。`use_absolute_bounds=false` / `contents_only=false` では画像自体が null — Figma API は隠しノードを描画不能。製品経路では `figma_export_hidden_blank` critical 警告が `preflight.warnings` と `structuredContent.figmaExport` へ出て status=UNCERTAIN（誤合格しない）。証跡 `.../real-figma-r1/`。
- **#136（実Figma正常系）**: 不透明 SOLID fill の可視 FRAME `9525:4760` で `opaqueFillExpected:true` が記録され、`background_missing` は非発火（実API正常応答での誤検知なし）。contents_only 有無どちらの実exportも完全不透明を独立確認。背景欠落そのものの実再現は今回のファイルでは未発生。
- **#113（限定検証済）**: `capture_device_serial` の実SDKテスト済み（serial引き渡し+端末エラー透過）。android provider は複数端末の選択肢提示・ANDROID_SERIAL・途中切断後のserial固定・不正serial拒否を33テストで確認。実機2台接続は環境上未検証。
- **#135（修正+テスト済）**: マスク候補説明は texture を写真と断定せず「文章やボタンも含まれ得る」と明示、採否は利用者判断・自動除外なし。issue実測値 0.53/0.71 の専用テストあり。
- **#118（7機能導線）**: desktop に node-inspection / fix-verification / animation-comparison / ignore-region / issue-report / report-export の panel+IPC+service が実装済み。get_design_tokens は node-inspection で同時取得。実Electron driver r3 で各画面を検証済み。端末撮影の導線は未実装（issue自体が別issue推奨）。
- **#79（部分）**: `.claude/settings.json` に `outputStyle:"Concise"` 入り・`7af80e54` にコミット済みだが develop 未マージ。claude.ai/code での実証は外部依存。

## 2026-09-17の追加作業（dogfood, MCPドキュメント整合）

- `docs/api/mcp-tools.md` を実装と突き合わせ、3件の実食い違いを修正: `generate_diff_report` の `comparison_id`（推奨・軽量経路）未記載、`set_crop_region` の `screenshot_width`/`screenshot_height` 未記載、「compare_design のみが outputSchema を持つ」という古い記述（実際は compare_animation / verify_fix / report_issue も structuredContent を返す）。
- 未収載だった8ツール（`compare_animation`, `verify_fix`, `create_project`, `list_projects`, `delete_project`, `delete_ignore_region`, `set_figma_token`, `report_issue`）のセクションを追加。verify_fix の baseline 拒否条件・verdict/comparisonStatus の分離、compare_animation の driftMeasured 契約、report_issue の sanitize/dedupe 出力を実装から転記。
- `compare_design` の loopGuard 停止契約を実装どおりに明記（stop時は即座に反復状態を破棄、reason の5値の実意味）。
- 全ツールの実 inputSchema キーを機械抽出して doc と突合（script で全走査）。収載9ツール中残存差分0を確認。
- ゲート: `pnpm test` turbo 10/10 + script 59 pass/1 skip、`pnpm typecheck` 10/10、`pnpm lint` 9/9（warning のみ、既存の complexity 警告）。
- docs-only 変更のため runtime 証跡の再実行は不要。最終製品SHAは依然未確定。

## 2026-09-18の追加検証（dogfood, 3platform driver + iOS sim実証）

- 候補SHA `7f40a848`（= driver群込みの最新HEAD）。worktree clean。bundle で Windows/macmini へ配布済み。
- **stdio-campaign-verification.mjs**（新規, 14件）: M02/M03/M05/M07/M08/M10契約/C04-C08/C11契約/C12/X09。3platform全てで 14/14 PASS。
  - linux-wsl: `.../stdio-campaign-r4`
  - macOS (macmini, node 25.6.1): `.../macos-smoke-r2`
  - Windows (実機, node 25.6.1): `.../windows-smoke-r5`
- **実Figma拡張**（stdio-real-figma-verification.mjs）: M04 list_figma_frames（312 frames実列挙・paging・id_name投影・不正URL拒否）、M06 inspect_node（TEXT+DROP_SHADOW `9883:7750`、opacity 0.05 `10198:32`、いずれもraw RESTで選定した実ノード）、M10 verify_fix 実経路（実baseline→同寸法defect画像→`verdict:"improved"` for `9525:4762`、同一defect再送→`unchanged`）、M16相当（generate_diff_report が comparison_id から実ファイル出力）。証跡 `.../real-figma-r6`。
- **iOS Simulator実証**（stdio-ios-sim-verification.mjs, macmini）: booted sim `devin-ios-verify-20260916` から `capture_device:"ios-sim"` で 1206x2622 の実PNG取り込み、simctl直接撮影と寸法一致、system:status-bar 162px 自動マスク、capture_scroll は明示拒否（嘘の結合を返さない）。証跡 `.../ios-sim-r2`。
- **M01 新規AI導入**: fresh subagent（個人スキルなし）にリポジトリパスのみ渡し → READMEからstdio起動を自力発見、tools/list で17tool、schema適合の compare_design 完走（diff領域が注入矩形と完全一致）。**発見した実ギャップ**: mcp-server README に Node>=25 要件が未記載（Node22だと `node:sqlite` で即死→clientは不透明な -32000 しか見えない）。
- **driver修正（d4159e47）**: Windowsで `os.homedir()` が USERPROFILE を見るため sandbox HOME が効かず、set_figma_token が実ユーザーの credentials.json を汚染する問題を修正（USERPROFILE も隔離）。実ファイルはWSLの実tokenで復元済み。biome binary 不在環境では plain JSON fallback。
- **既知の腐ったscript**: `app/chrome-extension/script/background-error-contract-smoke.mjs` / `token-contract-smoke.mjs` は現行ソースに存在しない関数（formatTokenSetError 等）を参照する死にscript — X01/X02 の実Chrome検証は未整備。
- **X01/X02 実Chrome拡張 E2E**（script/real-chrome-e2e.mjs 新規, xvfb + 実Chromium + dist読み込み）:
  - 出荷manifestそのまま (chrome-ext-r1): popup表示・Upload→実画像読込・Show Overlayで実ページに `#figdiff-overlay` 実挿入、blob URL画像、opacity 0.25 実適用、Draggable Overlay で実マウスドラッグ `translate(80px,60px)`、scrollY=1500 でも fixed で不動、ページ遷移でoverlay漏洩なし、Hide後にページ実クリック可。
  - 権限拡張複製manifest (`<all_urls>` host権限のみ差分, chrome-ext-r1-granted): Capture & Compare が captureVisibleTab→OffscreenCanvas pixelmatch移植→`.match-rate: 43.44%` 実描画、Token タブで SW chrome.storage 往復・clear を実証。
  - **発見した実欠陥/ギャップ**:
    1. `state.error` が renderFigmaTab 内にしか描画されず、Upload/Token タブ滞在中の capture/compare/overlay 失敗はユーザーに完全不可視（chrome-ext-r1 の `X01_compare_dom` が証拠）。
    2. ページ遷移で content 側 overlay は消えるが popup の `overlayActive` は残留 → 遷移後の toggle が "Hide Overlay" のまま（`X02_state_after_nav`）。
    3. `captureVisibleTab` は `<all_urls>` か activeTab が要る — popup を tab として開く自動化では activeTab が付与されず失敗する（実ユーザーは toolbar クリックで付与、native-extension-host r1 がその経路を実証済）。特定 host_permissions では不足。
  - 3platform横断 (92ec88e7): macOS は SSH 経由 `--headless=new` で実施、Windows は実機 GUI セッション。両platformで出荷manifest実行は X02全項+token往復 PASS・compare不可視を再現（platform共通の実挙動）、権限複製では macOS `48.96%`、Windows `43.5%` の実match-rateを確認。証跡 `chrome-ext-mac-r1(-granted)` / `chrome-ext-win-r1(-granted)`。
- 未完: X05 Android実機（0台=blocked見込）、X06 iOS実機、M12 実GitHub起票（外部write要承認）、desktop経路のWindows/macOS実行、台帳記入と2巡。
