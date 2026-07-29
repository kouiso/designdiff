# 実画面相当の雑音を測り、しきい値を根拠つきで動かした (2026-07-28)

前回のレシート（`p5-oracle-gate-2026-07-28.md`）は「設計」と「実装」を全く同じ描画経路で
撮ったため sha256 が一致し、残差 0 が当然の値になった。それは雑音が無いことの証拠にならない。
この記録は、その反省を踏まえて意図的に描画経路を分けた2枚で雑音の底を測り直したものである。

## 何を測ったか

固定 HTML（`verification/fixture/live-noise-calibration/fixture.html`、角丸カード・
グラデーション・文字を含む）を Playwright で描画経路の異なる2通りで撮影し、
独立オラクル `script/oracle-compare.mjs`（sharp + pixelmatch のみ、`@figdiff/shared` を
一切 import しない）で残差を測定した。

| 組 | 撮影方法 | 内容 |
|---|---|---|
| 雑音の底 | native（deviceScaleFactor=1）対 downscaled（deviceScaleFactor=3 で撮影し Sharp で1/3に縮小） | 同じ UI、描画経路だけが違う |
| 実差分の下限 | native 対 defect-native（バッジ背景色のみ変更、同じ描画経路） | 局所的な色差分（面積比 約1.6%） |

| 測定 | 残差（correctedResidualRate） | 検出オフセット |
|---|---|---|
| 雑音の底 | 0.008158333333333333（0.8158%） | (0, 0) |
| 実差分の下限 | 0.018591666666666666（1.8592%） | (0, 0) |

判定: 旧しきい値 `LIVE_RESIDUAL_FAIL_THRESHOLD = 0.005`（0.5%）は雑音の底
（0.8158%）より低い。つまり実画面では、実装に何も問題が無くても描画経路の違い
だけで FAIL に落ちる状態だった。旧しきい値のままでは校正の目的を満たさないため、
しきい値を動かした。

## 再現に要る情報

- designdiff の commit: このコミット自身の親（PR差分の直前）
- 校正用固定 HTML: `verification/fixture/live-noise-calibration/fixture.html`
- 局所差分用固定 HTML: `verification/fixture/live-noise-calibration/fixture-defect.html`
  （`.badge` の `background` を `linear-gradient(90deg, #5b7cfa 0%, #8f6bf5 100%)` から
  `#d92d2d` へ変更しただけ）
- 撮影画像とハッシュ:
  - `verification/fixture/live-noise-calibration/native.png`
    sha256 `8ada0d2d49b0e02c12abc7169e532f27a2598a2b35b885698e09e758472532e2`
  - `verification/fixture/live-noise-calibration/downscaled.png`
    sha256 `ae4bec70fe6d9e6156913a04a469115fbc2104cb0a078ed1a7359516df2dfd10`
  - `verification/fixture/live-noise-calibration/defect-native.png`
    sha256 `b499010e5afda3fce423a816fe06e0725dd3f867b9fbcef4de3046eecfac4185`
- 実行した道具: node v25.6.1 / @playwright/test 1.60.0 (chromium) / sharp 0.35.3 /
  pixelmatch 5.3.0（すべて `script/oracle-compare.mjs` と同じ独立経路）
- 実行したコマンド: `node verification/script/live-noise-calibration.mjs`
- 生データ: `verification/fixture/live-noise-calibration/calibration-report.json`
  （2回実行して同じ数値を確認済み。決定的で、揺れは無い）

## この記録で言えること

- 校正の2枚は sha256 が一致しない（バイト単位で異なる）。前回のレシートが踏んだ
  「同じ経路で2回撮って残差0を当然の値と誤読する」罠を踏んでいない。
- 独立オラクルで測った雑音の底は 0.8158%、旧しきい値 0.5% を上回る。
  つまり旧しきい値は実画面で偽陽性（FAIL）を生む水準だった。
- 局所的な色差分（面積比 約1.6%）は残差 1.8592% で、雑音の底の約2.3倍。
  雑音の底と実差分の下限の間には測定可能な空白がある。

## しきい値の判断

`LIVE_RESIDUAL_FAIL_THRESHOLD` を `0.005` から `0.012` へ動かした
（`script/oracle-threshold.mjs`、独立コミット）。

根拠: 雑音の底（0.008158）と実差分の下限（0.018592）の幾何平均
`sqrt(0.008158 * 0.018592) ≈ 0.01232` に近い `0.012` を採用した。
比率で見ると、新しきい値は雑音の底から約47%上（`0.012 / 0.008158 ≈ 1.47`）、
実差分の下限からは約35%下（`0.018592 / 0.012 ≈ 1.55`）に位置し、どちらの側にも
極端に寄っていない。

線形の中間値（`(0.008158 + 0.018592) / 2 = 0.013375`）ではなく幾何平均を採った
理由: 両者は約2.3倍の比率で離れており、線形中間値は実差分の下限側（1.859%）に
寄りすぎる（雑音の底からの余裕 64% に対し、実差分側の余裕 28%と非対称になる）。
残差は割合の値であり、桁のスケールで離れた2値の「中間」は対数（幾何平均）で
取るほうが両側の余裕を対称に近づけられる。

## まだ確認できていないこと

- **標本数は1組のみ**（今回の校正1回分）。同一マシン・同一 Chromium で2回実行し
  同じ数値が出ることは確認したが、複数の異なる UI パターン・複数の描画経路差で
  測ってはいない。しきい値の位置は今回の1標本に基づく推定であり、統計的に
  確定した値ではない。
- **CI 環境（Linux）での再測定は未実施**。この校正は macOS ローカルの Chromium で
  行った。CI の `RUNNER_LINUX` はフォントレンダリングスタック（freetype 等）が
  異なり、雑音の底が変わる可能性がある。CI で `oracle-verdict-agreement.mjs` と
  golden fixture 4組が現行どおり通ることは確認するが（下記）、この校正スクリプト
  自体を CI ジョブとしては配線していない（実行に Playwright ブラウザの起動を伴い、
  既存の CI 時間予算を圧迫するため。手動の校正ツールとして
  `verification/script/live-noise-calibration.mjs` を残す）。
- **偽陽性が実際のフルアプリ画面（Figma フレーム比較）で解消されたかは未確認**。
  この校正は自己完結した固定 HTML 1枚のみを対象にしており、実際の LP・
  アプリ画面での雑音がこの数値と一致する保証はない。

新しいしきい値を裏づける実測が増えるまでは、`script/oracle-threshold.mjs` の
コメントに残した通り、動かす必要が出たら測った数字と画像のハッシュを添えて
独立したコミットで動かす。収束判定を通すために黙って緩めることはしない。
