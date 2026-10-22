# Issue 376 クラウド検証（2026-10-22）

背景の丸めで墨量を増減させる引継ぎWIPを検証し、残っていた screenshot 側の前景・ブレンド軸・成分数・行数の背景共用を修正した。色・墨量・トポロジの許容閾値は変更していない。既知の半被覆2成分が失われる回帰は修正前に失敗し、修正後に両背景順で成功した。

実境界線の局所2px移動は、移動量が証明されてもminor診断に留まりPASSになっていた。`local_displacement` の整数計測が既存全体変位の2px境界以上ならcriticalにし、セクションの同一トークン救済があってもFAILにする。実画素から期待値を決めた22統合対照、実MCP11対照で検証した。1pxの既存許容は保持する。残差ノイズのテストは許容内の1px配置を前提へ変え、9/10画素境界の検証を維持した。既存の2px救済テストは実配置を検出する期待へ変更した。

## 根拠と残件

- [33検体の分類](stroke-diagnostics.json): 宣言PASS12件は依然すべてFAIL、宣言FAIL21件はすべてFAIL。**宣言との不一致12件・誤PASS0件**。これはラベルとの比較であり、12件全てが誤FAILと独立に確定した意味ではない。完了条件は未達で、#376は閉じない。
- 宣言PASS内の分類呼出しは、成立1127、topology拒否163、背景93、墨量61、前景トークン51、前景推定27、ブレンド軸20。halo試行数と最終拒否数は別の集計。200クラスタ上限に達する例があり、未採点の全領域を検証したとは言えない。
- [独立画素測定](pair-22-geometry.json): `pair-22-hm-gate1-9776-6584/correct` の入力境界は116/158行から60/102行へ**両方−56px**、キーボードの最良移動は0px。製品分類器を使わずRGB画素で確認した。この同じ検体でtopology拒否107領域を再現した。PASS宣言・AA/stroke-only説明は実配置と矛盾する。全体の位置合わせや閾値緩和で救済しない。
- pair07/08/09/11/15/18/19/23にも墨量・トークン・背景・形状の拒否が残る。分類器の拒否段階だけから同一グリフやフォントウェイト置換を確定できない。各bbox・墨量・制限値の例をJSONに保持した。独立した文字／フォント・レイアウトの正本判断が必要。
- 仕様判断として分離: 確定した線・縁の局所2px以上は今回FAILにした。文字全体の相関だけによる `same_token_content_offset` は既存のadvisory仕様を保持する（既存の2px/4px診断テストも保持）。固定部分が相関を支配すると部分56px差を0px近辺と推定するため、この信号だけを配置保証にしない。1px移動と253↔255背景段差を同時に与えると既存flat-colorトークンガードでFAILとなるケースもあり、その色仕様は緩和していない。

## 成果物

- [実MCP実行](runtime.json): 11/11。253↔255両順で配置一致PASS、局所−2px/−56px・墨量2倍・色51→91はFAIL。同背景255の−1pxはPASS。既知1620/3240墨画素と移動先／固定キーボードを独立に確認。built reflow APIも既知2成分を両順で保持（2/2）。
- [半被覆回帰のRED](reflow-red.log)、[105関連テストのGREEN](geometry-green.log)、[検証一覧](validation.json)。既存墨量WIPの4実MCP対照も再実行した。全パッケージunitは合計3011件（shared677・MCP916を含む）、ルートNodeテスト59成功・Windows限定1skip。
- [入力検証付き再現器](../issue-376-baseline/reproduce.mjs): 18ペア33variantの存在、宣言、全画像SHA256を照合してから実行する。欠損・差替えをゼロ件合格として保存しない。7入力ガードテスト付き。sourceCommitの固定値も除去した。
- 変更前に#376、#375、draft #387と全open PRを確認。#387は`f408dafdb`のまま。今回のブランチはその内容を祖先として保全し、#387の修復履歴・mask・残差・stripe機能は変更していない。必須検査のため#387由来のテスト1箇所の整形と証跡スクリプト3本の明示Buffer importのみ補正した。

## 再実行

ブランチの要件はNode >=25.6.1、pnpm9.15.0。実行はNode v25.6.1/Linux x64、pnpm9.15.0、既存lockfileを使用。現developのNode更新をこのWIPへ混ぜていない。標準Electronインストーラのfetch失敗は、同じ公式release ZIPをcurl取得し同梱checksums.jsonのSHA256で照合して解決した。フックやインストールスクリプトの無効化、通信・認証設定の変更はしていない。

```bash
export PATH=/tmp/designdiff-toolchain/node-v25.6.1-linux-x64/bin:/tmp/designdiff-toolchain/bin:/tmp/designdiff-hooks/node_modules/.bin:$PATH
export COREPACK_HOME=/tmp/designdiff-corepack npm_config_store_dir=/tmp/designdiff-pnpm-store
pnpm install --frozen-lockfile
pnpm typecheck
pnpm --filter @figdiff/shared exec tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck src/signal/glyph-edge-raster.test.ts src/signal/text-reflow.test.ts
pnpm lint:eslint
python3 docs/evidence/issue-376-cloud/reap-children.py task ci:fast
node --test docs/evidence/issue-376-baseline/reproduce.test.mjs
pnpm --filter @figdiff/mcp-server run test:stdio-smoke
node docs/evidence/issue-376-ink/reproduce.mjs /workspace/designdiff /tmp/designdiff-ink-runtime-final
node docs/evidence/issue-376-cloud/reproduce-runtime.mjs /workspace/designdiff docs/evidence/issue-376-cloud/runtime.json
```

このコンテナのPID 1は`tail`で、終了した孤児をreapしない。通常実行の`ci:fast`とdev-log単独実行は既存の孫プロセス終了テスト2件に失敗し、対象PIDがPPID=1・state=Zの終了済みプロセスであることを確認した。[監督プロセス](reap-children.py)を親にして終了PIDをwaitで回収すると、製品・テスト・フックを変更せずdev-log33件と全`ci:fast`が合格した。実際の生存プロセスを無視する処理やテストの無効化はない。pre-pushも同じ親の下で既存フックを実行する。

実画像は既存PR375のcommit `ea13c68354412868f46b808a5069b707481293a4` からローカルに取得した。新しい実画像のcommit・アップロードは行っていない。

```bash
git fetch origin refs/heads/devin/1791606227-issue-243-gate1-fixtures:refs/remotes/origin/devin/1791606227-issue-243-gate1-fixtures
mkdir -p /tmp/designdiff-gate1
git archive ea13c68354412868f46b808a5069b707481293a4 verification/fixture | tar -x -C /tmp/designdiff-gate1
node docs/evidence/issue-376-baseline/reproduce.mjs /workspace/designdiff /tmp/designdiff-gate1/verification/fixture /tmp/designdiff-gate1-current.json
node docs/evidence/issue-376-cloud/classify-stroke.mjs /workspace/designdiff /tmp/designdiff-gate1/verification/fixture docs/evidence/issue-376-cloud/stroke-diagnostics.json
python3 docs/evidence/issue-376-cloud/measure-geometry.py /tmp/designdiff-gate1/verification/fixture/pair-22-hm-gate1-9776-6584 docs/evidence/issue-376-cloud/pair-22-geometry.json
```

診断は実built classifierをメモリ上で計測する。製品ファイルは変更せず、8ソース／distファイルの実行前後ハッシュを照合した。結果内HEADは計測時の`fb90407aa`で、未commit差分とファイルハッシュを明記している。最終commitのソースと照合可能であり、旧HEAD単体の合格を主張するものではない。詳細トレース約13MBは/tmpのみに置き、段階別3例までのコンパクトJSONを保存した。

## 検体別結果

入力SHA256・bbox例はstroke-diagnostics.jsonを参照。すべて再実行した結果。墨量とtopology列は最終拒否数（halo試行数ではない）。宣言は変更していない。

| ペア | variant | 既存宣言 | 最新結果 | 墨量拒否 | topology拒否 |
|---|---|---|---|---:|---:|
| pair-07-hm-gate1-9810-3312 | correct | pass | fail | 17 | 6 |
| pair-07-hm-gate1-9810-3312 | drift-2px | fail | fail | 17 | 4 |
| pair-07-hm-gate1-9810-3312 | drift-1px | pass | fail | 15 | 5 |
| pair-07-hm-gate1-9810-3312 | linewidth | fail | fail | 143 | 6 |
| pair-08-hm-gate1-9721-6204 | correct | pass | fail | 2 | 0 |
| pair-08-hm-gate1-9721-6204 | drift-2px | fail | fail | 4 | 1 |
| pair-09-hm-gate1-9776-6791 | correct | pass | fail | 6 | 0 |
| pair-09-hm-gate1-9776-6791 | drift-2px | fail | fail | 6 | 0 |
| pair-09-hm-gate1-9776-6791 | drift-1px | pass | fail | 6 | 0 |
| pair-09-hm-gate1-9776-6791 | linewidth | fail | fail | 123 | 0 |
| pair-10-hm-gate1-9776-6698 | correct | fail | fail | 3 | 127 |
| pair-11-hm-gate1-9776-6456 | correct | pass | fail | 2 | 0 |
| pair-11-hm-gate1-9776-6456 | drift-2px | fail | fail | 4 | 0 |
| pair-12-hm-gate1-9810-3193 | correct | fail | fail | 14 | 92 |
| pair-13-hm-gate1-9804-4204 | correct | fail | fail | 0 | 44 |
| pair-14-hm-gate1-9804-4285 | correct | fail | fail | 6 | 153 |
| pair-15-hm-gate1-9804-4369 | correct | pass | fail | 1 | 15 |
| pair-15-hm-gate1-9804-4369 | drift-2px | fail | fail | 3 | 16 |
| pair-15-hm-gate1-9804-4369 | drift-1px | pass | fail | 1 | 14 |
| pair-15-hm-gate1-9804-4369 | linewidth | fail | fail | 88 | 14 |
| pair-16-hm-gate1-9892-8063 | correct | fail | fail | 22 | 62 |
| pair-17-hm-gate1-9878-6665 | correct | fail | fail | 10 | 7 |
| pair-18-hm-gate1-9892-10228 | correct | pass | fail | 3 | 0 |
| pair-18-hm-gate1-9892-10228 | drift-2px | fail | fail | 3 | 0 |
| pair-19-hm-gate1-9863-5441 | correct | pass | fail | 3 | 1 |
| pair-19-hm-gate1-9863-5441 | drift-2px | fail | fail | 1 | 3 |
| pair-20-hm-gate1-9878-6036 | correct | fail | fail | 4 | 31 |
| pair-21-hm-gate1-9878-6362 | correct | fail | fail | 5 | 33 |
| pair-22-hm-gate1-9776-6584 | correct | pass | fail | 4 | 107 |
| pair-22-hm-gate1-9776-6584 | drift-2px | fail | fail | 4 | 107 |
| pair-23-hm-gate1-9799-4024 | correct | pass | fail | 1 | 15 |
| pair-23-hm-gate1-9799-4024 | drift-2px | fail | fail | 4 | 16 |
| pair-24-hm-gate1-9789-3641 | correct | fail | fail | 4 | 82 |

## 未検証範囲

macOS実Desktop、Retina、実フォント／実Figma host連携、本番・実認証・外部APIの受入れは今回実行していない。Desktop等のunit testとクラウドの合成MCP検証はそれらの合格を意味しない。CI workflowの明示起動、merge、draft解除、force push、保護ブランチpushは行わない。
