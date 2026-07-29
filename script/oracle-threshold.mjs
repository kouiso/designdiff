/**
 * 合否を分ける残差のしきい値。
 *
 * 2箇所に書くと、収束の判定とCIの検査が黙って別々の「正解」を持つ。
 * 動かすときは必ずここだけを動かす。
 */

/**
 * 合成した検体に対するしきい値。
 *
 * 一致する検体の残差は 0、一致しない検体は 2.0% 以上で、間が大きく空いている。
 * 0.5% はその空白の中に置いた値で、どちらへも寄っていない。
 */
export const RESIDUAL_FAIL_THRESHOLD = 0.005;

/**
 * 実際に撮った画面に対するしきい値。
 *
 * 2026-07-28 に実画面相当の校正を実施し、この値を 0.005 から 0.012 へ動かした。
 * 校正は Playwright で固定 HTML（verification/fixture/live-noise-calibration/）を
 * 意図的に違う描画経路（等倍 vs 高倍率撮影→縮小）で2枚撮り、独立オラクル
 * script/oracle-compare.mjs（sharp + pixelmatch のみ）で残差を測定した。
 *
 * - 雑音の底（同じ UI、描画経路だけが違う）: 残差 0.008158（0.8158%）
 *   画像: native.png sha256=8ada0d2d49b0e02c12abc7169e532f27a2598a2b35b885698e09e758472532e2
 *         downscaled.png sha256=ae4bec70fe6d9e6156913a04a469115fbc2104cb0a078ed1a7359516df2dfd10
 * - 実差分の下限（同じ描画経路、バッジ色のみ変えた局所的な色差分）: 残差 0.018592（1.8592%）
 *   画像: defect-native.png sha256=b499010e5afda3fce423a816fe06e0725dd3f867b9fbcef4de3046eecfac4185
 *
 * 旧しきい値 0.005 は雑音の底（0.008158）より低く、実画面では雑音だけで FAIL に
 * 落ちる状態だった。新しいしきい値 0.012 は両者の幾何平均に近い値
 * （sqrt(0.008158 * 0.018592) ≈ 0.01232）で、雑音の底から約47%上、実差分の
 * 下限から約35%下に位置する。生データは
 * verification/fixture/live-noise-calibration/calibration-report.json、
 * 判断の記録は verification/receipt/live-noise-calibration-2026-07-28.md を見よ。
 *
 * 標本数は1組のみ（今回の校正）。CI 環境（Linux）はローカル（macOS）と
 * フォントレンダリングが異なる可能性があり、この値がそのまま妥当とは限らない。
 * さらに動かす場合は、同じ形式（測った数字とハッシュを添えた独立コミット）で行う。
 */
export const LIVE_RESIDUAL_FAIL_THRESHOLD = 0.012;
