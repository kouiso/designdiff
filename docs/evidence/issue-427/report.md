# Issue #427: Gate1 独立オラクル分離度

結論: `0.02` / `0.15` の帯域は内容差と AA ノイズを分離できない。correct 18ペアと全派生を実測し、33 variant × 2 reference = 66 比較を保存した。分離可能性の受入は未達。閾値を緩めず、既存 expected.json・PNG・knownRedIssue (#243)・推定器を変更していない。

## 原本と競合確認

- develop `184eb7131ed3d0941b9d1a0fee5b0647c469f774` を remote と照合。#427 は open、担当なし、コメント0を確認。
- #375 は GitHub PR metadata の merged=true、merge commit `10e3ab894c2fbacb94aad44a847220ee05c0e509` が起点の祖先であることを確認。closed から推測していない。
- open PR #424 (fixture-runner.test.ts)、#429 (#405 stitch)、#423 (dependencies)、#387 (compare/verify/oracle) の変更一覧と照合し、共有ファイルは変更していない。

## 方法と限界

RGB の max-channel delta が **40 より大きい**画素の割合が既存 runner の指標。無条件の生画素不一致率 (delta > 0) とは異なるため両方を測った。opaque sRGB のみ受け入れ、resize・alignment・mask・FigDiff の判定・match% は使わない。実 Figma API、実機、Devin セッション操作は不要で未実施。正解群は元検体の宣言を用いており、意味的な正解の再認定はしていない。

寸法不一致は pair-13 (390×692 vs 320×667)、16 (390×692 vs 430×932)、24 (390×692 vs 320×667)。既存 runner は寸法が異なると ratio=1 を返すが、これは画素比較の結果ではない。measurement.json は legacyRunnerRatio=1 と metrics=null を区別する。分離表では比較可能な fail 6ペアのみを使う。寸法差3件を含む fail 群でも最小値は変わらない。

## correct 群の分離帯

| 指標 | pass min–max (9) | fail min–max (同寸法6) | fail min − pass max |
|---|---:|---:|---:|
| rawAbove10 | 2.9576%–22.6171% | 9.5950%–29.0796% | -13.0221 pp |
| rawAbove20 | 1.8968%–14.9863% | 5.5131%–20.4476% | -9.4732 pp |
| rawAbove80 | 0.6214%–5.6273% | 2.8765%–15.5551% | -2.7508 pp |
| rawAbove160 | 0.0300%–2.7338% | 0.9188%–10.7937% | -1.8150 pp |
| rawAbove40 | 1.2928%–8.8825% | 4.1004%–17.6145% | -4.7821 pp |
| exactNonzero | 8.6513%–67.6404% | 19.3157%–81.0616% | -48.3247 pp |
| maxTile32 | 27.3438%–90.1367% | 43.2617%–100.0000% | -46.8750 pp |
| symmetricUnexplained1px | 0.3201%–5.9867% | 1.3408%–15.0908% | -4.6460 pp |

主指標 delta>40 の pass 最大は pair-22、fail 最小は pair-21。8.8825% と4.1004%の順が逆転し、単一の差分率閾値による分離は不可能。0.02–0.15 のどちらの宣言も満たす検体が存在するので、元の上下限は画像破損の粗い検査であり、AA と内容差の分類器ではない。

## 次の最小検査 (実行済み)

閾値だけの問題かを調べるため、delta 0/10/20/40/80/160 の sweep を実行したが、全て負の分離帯だった。独立指標として、(1) 固定32px tile内の最大差分密度 (端tileは実面積)、(2) 半径1pxの近傍に色の説明がない画素割合の双方向最大を追加実行した。両方とも負の分離帯だった。エッジ付近の差分は delta>40 にも現れ、意味的差分が小面積の画面は全体平均に希釈される。エッジ差分だけから AA と断定はできない (追加検査で位置差も確認)。追加指標は探索用であり受入閾値には採用しない。

pair-21 の両 PNG を直接目視し、設定リストの「単位設定」「データのエクスポート」が実装に無いことを確認した。全体差分率が pass 最大より低いことは、少数行の欠落を全画面平均で判定する限界を具体的に示す。

追加検査で pair-22 に約56pxの位置差を確認したため、まず許容する撮影条件差の定義か同条件での再キャプチャが必要。対応領域・テキスト/アイコン同一性を独立に裏付けてから領域限定の画素指標を検証する。領域を正解に合わせて最適化して全体合格としない。今回のピクセル指標だけでは内容同一性を証明できず、#243 の修正完了や #427 の受入完了とは言えない。

## 全33 variant 実測表

値は delta>40 の割合。Figma比較で寸法不一致の行は N/A。完全なdelta histogram、6閾値、寸法、PNG/expected.json の SHA256、局所指標は measurement.json。

| pair | 群 | variant | expected | vs Figma | vs correct |
|---|---|---|---|---:|---:|
| 07 | pass | correct | pass | 7.2310% | 0.0000% |
| 07 | pass | drift-2px | fail | 7.8257% | 6.2368% |
| 07 | pass | drift-1px | pass | 7.5033% | 4.5031% |
| 07 | pass | linewidth | fail | 10.6588% | 6.3150% |
| 08 | pass | correct | pass | 1.2928% | 0.0000% |
| 08 | pass | drift-2px | fail | 2.1502% | 1.8997% |
| 09 | pass | correct | pass | 8.0406% | 0.0000% |
| 09 | pass | drift-2px | fail | 8.5657% | 4.4309% |
| 09 | pass | drift-1px | pass | 8.3048% | 3.0158% |
| 09 | pass | linewidth | fail | 11.3525% | 4.0737% |
| 10 | fail | correct | fail | 11.9523% | 0.0000% |
| 11 | pass | correct | pass | 3.5205% | 0.0000% |
| 11 | pass | drift-2px | fail | 5.1556% | 4.9770% |
| 12 | fail | correct | fail | 6.4696% | 0.0000% |
| 13 | fail | correct | fail | N/A (寸法差) | 0.0000% |
| 14 | fail | correct | fail | 17.6145% | 0.0000% |
| 15 | pass | correct | pass | 4.0470% | 0.0000% |
| 15 | pass | drift-2px | fail | 4.6917% | 2.9924% |
| 15 | pass | drift-1px | pass | 4.4253% | 2.0361% |
| 15 | pass | linewidth | fail | 5.8404% | 3.2111% |
| 16 | fail | correct | fail | N/A (寸法差) | 0.0000% |
| 17 | fail | correct | fail | 6.0273% | 0.0000% |
| 18 | pass | correct | pass | 2.4455% | 0.0000% |
| 18 | pass | drift-2px | fail | 3.8680% | 3.2400% |
| 19 | pass | correct | pass | 3.0328% | 0.0000% |
| 19 | pass | drift-2px | fail | 3.0443% | 2.0857% |
| 20 | fail | correct | fail | 5.4053% | 0.0000% |
| 21 | fail | correct | fail | 4.1004% | 0.0000% |
| 22 | pass | correct | pass | 8.8825% | 0.0000% |
| 22 | pass | drift-2px | fail | 11.5726% | 5.4183% |
| 23 | pass | correct | pass | 3.5975% | 0.0000% |
| 23 | pass | drift-2px | fail | 4.5116% | 3.0299% |
| 24 | fail | correct | fail | N/A (寸法差) | 0.0000% |

## 実行・検証

```sh
node verification/script/measure-gate1-oracle.mjs /tmp/gate1-measurement.json
node --test verification/script/measure-gate1-oracle.test.mjs
node verification/script/generate-fixtures.mjs --check
```

出力先は既存ファイルを上書きしない (wx)。全18ペア・33 variantを固定し、欠損・不正寸法・透過・件数変更で失敗する。4M pixels上限、sharp concurrency=1/cache=false、逐次処理で負荷を制限。環境は CPU5、メモリ17GiB、空き30GiB。60秒 timeout で測定・検証を実行し、欠損や不正画像があれば停止、群が重なれば指標追加へ切替と実行前に決定した。

初回コード版の unit 4件・Biome・ESLint・checkJs/TypeScript・派生15 PNG再生成検査に成功。測定の再実行はbyte一致し、別デコーダ(Pillow/NumPy)でも66比較行のうち同寸法63行×6閾値と、寸法不一致3行のnullを照合した。当時のexit code・ツール版・source SHA256は review/validation-before-review.json と従来の *.log に保存。製品全体テストは未実施。当時はNode v24.19.0で、対応版は未検証だったが、自己レビュー版ではNode26.12.1で関連検査を実行済み (現在のvalidation.json)。依存は/tmpに導入し、repo lockfileには最終差分なし。

## 配送と残件

専用ブランチ test/issue-427-independent-oracle。push/PR/merge/deploy/CI実行は未実施。GitHub REST の workflows と hooks 読取は Forbidden だったため、禁止CI/deploy・auto-merge等の副作用を確認できず、pushは保留 (未試行)。別経路で拒否を回避していない。これは自動承認審査の拒否ではなく、API読取の拒否である。ローカル変更とpatchを保持する。GitHub Project statusは外部status起点の副作用を確認できないため未変更。

DoD: 実測表・数値分離帯・監査への回答は用意した。独立指標の追加コードはローカルで検証済みだがPR未作成。指標の分離は未達で、受入完了とはしない。

追記: ローカル初回コミット bd4a4c4 の前に手動実行した message guard は @figdiff/shared 未ビルドで起動失敗したが、shellコマンドがそこで停止せずコミットされた。public-issue-guard.ts のみをビルドし workspace package をローカル解決した上で同じメッセージを追検査しPASS。フック無効化や --no-verify は行っていない。arrow検査も比較用ref不在で初回失敗したため、照合済みdevelopのSHAを ARROW_FUNCTION_BASE に指定してPASS。原失敗を検証成功に混同しない。

2026-11-01自己レビュー版: 最新結果は [self-review.md](self-review.md)、再現手順は [reproduction.md](reproduction.md)、現在ソースの対応版検証は validation.json と review/ のログを参照。初回Node24検証・旧Libraryアーカイブとは区別する。測定値は不変。
