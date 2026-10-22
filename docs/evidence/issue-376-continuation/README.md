# Issue 376 続行の証跡（2026-10-22）

基点は `82328a9354ab94c2f4f340c9e64877a2be19e4d0`。今回の修正は画像判定・診断のみで、UI変更はない。同条件のUI前後画像は対象外。実画像の新規コピー・アップロード、PR作成、外部連絡、workflow明示起動、mergeは行わない。

実行対象の製品差分SHA256は `627c8aedd0b7f691393b711670703184ab5db7e232e050dc3e57978ceea4441f`（基点からshared/MCPの4 source + 4 distを対象にした `git diff HEAD -- <paths>` の生バイト列。distは追跡対象外）。[検証台帳](validation.json)にパス、全source/testハッシュ、コマンド、終了値、ログハッシュを保存する。commit後も基点＋差分で検証対象を再特定できる。

続行時にIssue本文・コメントとPR #387を再読。Issue #376はopen・コメント0・本文更新2026-10-10、PR #387はdraft/open・head `f408dafdb27443630fc7f998b6d26d4cf88103a2`のまま。両headの `git ls-remote` 照合結果を[ログ](remote-read.log)へ保存し、別担当ブランチは更新しない。

## 12件の不一致の分類

「既存PASS宣言との不一致」と「誤FAIL」は分ける。同じ検体に配置差とstroke/描画差が混在するため、原因を一つへ押し込まない。Figma画像を正本とする既存仕様で判定し、元の宣言・画像ハッシュは変更しない。

| 検体 | 実配置・内容差の独立根拠 | stroke/描画差・資料不足 | 判定上の扱い |
|---|---|---|---|
| 07 correct | アイコン背景中心−12.5/−8px、ボタン+5px | グリフ・アイコン色差も混在。AAかfont/token差か原因未確定 | 実配置差を含むためPASS救済不可 |
| 07 drift-1px | correctのRGBA全画素が右1px変換。上記の大きい差が残る | 追加1pxだけを原因にした誤FAILとは呼べない | 同上 |
| 08 correct | 応答bubble白内側幅198→212px（+14） | 縦端1〜2pxの内訳はAAを含み不確定 | 実寸法差を含むためPASS救済不可 |
| 09 correct | 独立した2つの塗り領域がともにY−56px、drawer下部は固定 | 文字のAA/weight差の原因は未確定 | 実配置差を含むためPASS救済不可 |
| 09 drift-1px | 上記に加え全RGBAの正確な右1px変換 | 追加1pxが大きい既存差を消すことはない | 同上 |
| 11 correct | toast内の緑丸中心−4.5px、外側capsule中心−0.5px（相対−4px） | card境界は0/−1/−1/−1px、ここを2px累積差と主張しない。字送り原因は不明 | 非文字の相対配置差を含むためPASS救済不可 |
| 15 correct | avatar/header Y−56px、下部navは概ね固定 | 薄灰placeholderの局所墨量差25.85%は算術と一致。AA/weightの原因は未確定 | 実配置差を含むためPASS救済不可 |
| 15 drift-1px | header Y−56pxが残り、右1px派生を加えたもの | 同上 | 同上 |
| 18 correct | logo最良移動0、title最良Y+2px。説明行帯+2/+3px | 文字の画素位置/太さ/行幅が違う。ソース配置・font metrics・描画器のどれが原因かPNGだけでは不明。局所窓の墨量を独立計算し算術一致 | 純stroke-only正例と認定しない。原因未確定を保持 |
| 19 correct | 検索アイコンの緑画素0→137、4行目0→59。実装4行目glyphは1行目horse glyphとRGB完全一致 | gray→greenトークン差とsymbol置換はAA救済の対象外 | 実内容/色差を含むためPASS救済不可 |
| 22 correct | 入力境界Y−56px、keyboard最良移動0。topology拒否107領域 | 正本画像の実配置差をstroke差と呼ばない | 実配置差を含むためPASS救済不可 |
| 23 correct | header/avatar Y−56px、下部navは概ね固定 | placeholder墨量差は算術一致、原因未確定 | 実配置差を含むためPASS救済不可 |

根拠は [非文字geometry測定](geometry-classification.json) と [stroke/残り6件測定](stroke-analysis.json)。各スクリプトはPR375の保存SHA256を照合し、生画素を読んでROI・検出条件・測定値・不確実性を保存する。製品の合否を独立オラクルに使わない。**11件には非文字配置・寸法・内容差が確定し、pair18は文字の配置/描画混在で原因未確定**。12件全てを「AAだけの誤FAIL」とする引継ぎ前提は成立しない。純stroke-onlyのwhole-pair正例を新たに捏造しない。

## 独立して修正した計算不具合

相関のNCC値は一様な軸変換に不変でも、有効画素を数えるalpha>0.1条件は不変ではない。screenshot背景251をdesign背景255で計算すると、淡い232画素が真のalpha0.095から0.112745へ水増しされる。3つずつの濃い点（対応を外しても最大6点）しかないのに既存の最低8点条件をすり抜け、2px・peak0.999986を確定値として返していた。

`estimateContentOffset`へ末尾の任意screenshot背景引数を追加し、製品の呼出し元から照合済みの独自背景を渡す。既存7/8引数呼出しとignoreMaskの位置を維持し、最低点数・alpha・相関・報告閾値は変更しない。3点対照は推定不能へ戻り、8点の既知2px移動は保持する。

[REDログ](offset-red.log)、[GREENログ](offset-green.log)、[実built API実行](stroke-runtime.json)を保存する。実行コマンド・source/diffハッシュ・結果はvalidation.jsonにまとめる。

## 独立して修正したreflow窓の混入

現行規則で既に説明済みの1px移動した色付き枠線が、未説明の灰色テキストと一つの窓へ結合され、文字の単一色軸条件を壊していた。文字だけなら既存reflow規則でPASSする同一画素へ枠線を足すとFAILする。再分類候補へ既存の採点ヘルパー `isDiffClusterExplained` を使い、説明済みの領域を除外した。墨量・色・位置の許容閾値は変更しない。

新しい8テストは手作りのscoreではなく、生RGBA→`comparePixels`→実クラスタ生成→`buildDiffReport`を通す。生画素の矩形座標・65変更画素・墨量差0.2588086185を別算術で検証する。修正前の基点をdetached worktreeへ展開して現在のテストだけをコピーした実行では7成功/1失敗（exit 1）、修正後は8成功（exit 0）。依存node_modulesだけ既存環境からsymlinkし、製品sourceは各ツリーのものを解決する。両実行のstdout/stderrを[RED](reflow-group-red.log)/[GREEN](reflow-group-green.log)へ保存する。ログは行末の空白と末尾の空行だけを除き、元バイト列と保存後のSHA256を台帳へ併記する。全関連113テストの[GREEN](related-mcp-green.log)も併記する。

[別プロセスの実MCP 8対照](reflow-runtime.json)も全て独立期待値に一致。文字単独と既存許容の枠線1pxはPASS、枠線2/56px・文字欠落・太線化・色トークン変更・opt-inなしはFAIL。ここで太線化が拒否されることと、次節の対称stem反例が未解決なことは別々に記録する。

## 相関診断の既存仕様と新判断

- 既存仕様で確定: 点数不足、周期曖昧、相関peak0.8未満、探索端のclipped扱い、生値で1.5/3.5pxを判断すること。今回の点数水増しはこの既存仕様への不具合であり修正する。
- 既存仕様のまま: `same_token_content_offset`だけの文字位置診断はadvisoryで、合否を変えない。2px/4pxの既存テストが明示している。確定した局所線変位2pxは前commitでcritical化済み。相関全体に固定領域が多いと部分56pxを0px近辺と推定するため、相関だけでは配置保証にならない。
- 新判断: 相関のみの文字位置推定を一律FAILへ結び付けること、又は後述の曖昧strokeの扱い。新判断を既存仕様への計算修正と混ぜない。

## 一問に分離したstroke仕様の矛盾（回答待ち）

#376はウェイト置換の見逃しを禁止する一方、既存の `トポロジ強一致の窓ではインク量差を0.35まで許す` テストは25〜35%の救済を要求する。中心を保った既知の5px→7px太線化は墨量255→357、差28.57%、局所窓33.33%となり、実APIのPNG/section両方でPASSする。追加の7px→9px太線化も357→459画素・全体墨量差22.22%で両経路PASSとなり、0.35許容を除くだけでは分離できない。[再現結果](stroke-runtime.json)のこの4件は**既知の不具合の観測であり合格証跡ではない**。

対称な太線化はstem中心・medial ridgeも変えない。スケルトン包含だけで同一weightを証明する案は、この反例を除外できない。実pair18の局所stroke差にもpaired font/weight/renderer実記録がなく、PNGだけで原因を決められない。

本人への一問は、こうした曖昧strokeを「FAIL（見逃し回避、描画差の誤FAILは残る）」又は「UNCERTAIN（PASSを防いで再確認へ回す）」のどちらにするか。PASSへ通す閾値緩和は選択肢にしない。回答が必要なこの挙動変更は保留し、独立した計算修正・実画像分類・検証を継続する。

## 実行と未検証

```bash
export PATH=/tmp/designdiff-toolchain/node-v25.6.1-linux-x64/bin:/tmp/designdiff-toolchain/bin:/tmp/designdiff-hooks/node_modules/.bin:$PATH
export COREPACK_HOME=/tmp/designdiff-corepack npm_config_store_dir=/tmp/designdiff-pnpm-store
pnpm --filter @figdiff/mcp-server... build
pnpm --filter @figdiff/shared exec vitest run src/signal/glyph-edge-raster.test.ts src/signal/text-reflow.test.ts
pnpm typecheck
pnpm --filter @figdiff/shared exec tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck src/signal/glyph-edge-raster.test.ts src/signal/text-reflow.test.ts
pnpm --filter @figdiff/mcp-server exec tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck src/service/diff-report-reflow-group.test.ts src/service/image-compare-stroke-background.test.ts
pnpm lint:eslint
python3 docs/evidence/issue-376-cloud/reap-children.py task ci:fast
python3 docs/evidence/issue-376-continuation/geometry-classification.py /tmp/designdiff-gate1/verification/fixture docs/evidence/issue-376-continuation/geometry-classification.json
python3 docs/evidence/issue-376-continuation/stroke-analysis.py /tmp/designdiff-gate1/verification/fixture docs/evidence/issue-376-continuation/stroke-analysis.json
node docs/evidence/issue-376-continuation/reproduce-stroke.mjs /workspace/designdiff docs/evidence/issue-376-continuation/stroke-runtime.json
node docs/evidence/issue-376-continuation/reproduce-reflow.mjs /workspace/designdiff docs/evidence/issue-376-continuation/reflow-runtime.json
node docs/evidence/issue-376-cloud/classify-stroke.mjs /workspace/designdiff /tmp/designdiff-gate1/verification/fixture docs/evidence/issue-376-continuation/stroke-diagnostics.json
```

最新の `ci:fast` はshared679・MCP924を含む計3021ユニットテスト成功、root Nodeは59成功/0失敗/Windows専用1skip。型検査、追加テストの明示型検査、全ESLintも成功（従来の2 warning）。Turbo local cacheを利用した範囲は実ログに表示される。container PID1の子プロセス回収不足に対応する既存の小さいsupervisorを使い、テスト・フックの内容は変更しない。remote CIの新規実行/合格を主張しない。

macOS実Desktop/Retina/実フォント/実Figma連携は今回未実行。実画像再配布、認証・通信・本番設定の変更はしていない。#376全体の完了・PRの承認を主張しない。
