/**
 * compare_design — Primary MCP Tool
 * Pixel-level diff between Figma design and implementation screenshot.
 * AI should ALWAYS start with this tool.
 */

import { z } from "zod";

import {
  AnchorRegionSchema,
  CompareDesignResultSchema,
  ComparisonCampaignIdSchema,
  ComparisonConditionsInputSchema,
  IgnoreRegionSchema,
  type CompareDesignResult,
  type DiffVerdict,
} from "@figdiff/shared";

import { writeActiveSession } from "../service/active-session.js";
import { runCompareDesign } from "../service/compare-design-runner.js";
import { persistDetailJson } from "../service/persist-detail.js";
import {
  assertFigdiffStorageWritable,
  isFigdiffStorageError,
  toFigdiffStorageErrorPayload,
} from "../service/storage-permission.js";
import { assertNoUnknownToolArguments } from "../util/raw-tool-arguments.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const MAX_INLINE_DIFF_REGIONS = 20;

const DESCRIPTION = `デザインと実装のピクセル差分を検出します。

## 使用条件
- 実装のCSS/HTML修正時は【必ず】このツールを最初に実行すること
- status が "FAIL" の場合、inspect_node で詳細を取得し修正すること
- ループの継続可否は「ループ判定」行が最終決定。status が "FAIL" でも 停止 と出たら即座に止めて人間に報告すること。matchRate% は参考値であり、完成ゲートではない

## 出力の読み方
- ループ判定: 2つ目のテキストブロック先頭。停止 / 続行 / 取得できません。status より優先する。取得できません は停止として扱う
- 判定経路: token-diff = 色とフォントを値そのもので突き合わせた。要修正の項目は設計側の値が確定しているので、そのまま直すこと。anchor = 宣言した縦位置アンカーの位置規則違反。該当アンカーの期待位置へ配置を直すこと。pixel = 値の突合が使えず画素だけで見た（理由が同じ欄に出る）。この場合フォントの縁のぼかしに埋もれる色差は検出できない
- 構造SSIM判定: 2つ目のテキストブロック内の行。構造差なし (PASS) / 構造差あり (FAIL) / 判定不能 (INCONCLUSIVE) の日本語とトークン併記。構造面の部分判定であり、完了可否は status とループ判定で決める。INCONCLUSIVE は失敗ではないので直そうとせず報告すること
- status: "PASS" = 構造SSIM判定上の完了。"FAIL" = 修正が必要。"UNCERTAIN" = 判定の確からしさが足りず人間レビューへ回った状態。失敗ではないので直そうとせず報告すること
- completionCriteria: blocking=true の項目が "PASS" になるまで作業を続行。ただし status が "UNCERTAIN" の項目は直しても "PASS" にならないので、そこで止めて人間に報告する。matchRate は参考値
- nextAction: 次に実行すべきアクション（従うこと）
- subThresholdDiffPixelCount: diffPixelCount が 0 のときだけ返す。threshold を 0 に下げれば差分として数えられるが現 threshold では数えられない画素数（AA 検出で pixelmatch が除外する画素は含まない）。1 以上なら影のぼかし・グラデーションのような低振幅差分が残っている（サマリーにも警告が出る）。status は変わらないので、ループ判定が 続行 なら threshold を下げて再比較し、停止 なら人間へ報告する
- diffImagePath: 差分画像のローカルパス。Read ツールで開いて視覚確認できる（~/.figdiff/results/ に保存）
- diffRegions: 差分領域。レスポンス肥大化を防ぐため上位20件のみ。全件は regionsDetailPath のJSONファイルを参照

## 入力
- design_source: Figma URL（node-id付き推奨） or ローカル画像パス（ローカル画像はカレントディレクトリまたは ~/.figdiff/cache 配下。追加は FIGDIFF_ALLOWED_DIRS）
- screenshot: 実装スクリーンショットのローカルパス（screenshot_url / capture_device 使用時は省略可）
- screenshot_url: 撮影対象URL。指定時はPlaywrightで内部撮影しscreenshotの代わりに使用
- capture_device: 接続済みモバイル端末/SimulatorからPNGを撮影しscreenshotの代わりに使用（android/ios-sim/ios-device）。既定でOSステータスバー/ナビゲーションバーを ignore_regions として自動マスク
- capture_width: 撮影幅(px)。省略時はFigmaフレームの実幅を自動取得（screenshot_url指定時のみ有効）
- threshold: 色差の許容閾値（0-1）。profile を指定した場合はそちらが既定値になる
- profile: 比較プロファイル（strict/balanced/layout）。threshold 直接指定で上書き可
- project_id: Crop Region・ignore_regions・前回使用ノード自動補完に使うプロジェクトID（省略可）
- campaign_id: 独立した修正作業を識別するID。同じ作業の反復では同じIDを使い、新しいブランチ・作業では別IDにする。省略時は従来の対象単位の履歴を使う
- comparison_conditions: design / screenshotそれぞれのviewport{width,height}(論理px)、pixelRatio(物理px/論理px)、origin{x,y}(画像左上の共通参照座標、論理px)の申告。画像外寸はキャンバス寸法であり端末の高さとは限らない。未指定は未確認として報告し、異なる表示領域・原点ならCSS修正の前に撮影条件を確認する。申告値による自動変換は行わない
- ignore_regions: 既知の意図的差分マスク（省略可）。project_id の保存済みマスク、自動 system UI マスクと結合される。WP原文 vs Figmaプレースホルダ、Google Map埋め込み等の false-positive 抑制に使用。各矩形 {x,y,width,height,label?} 内のピクセルは差分検出/matchRate 分母から除外される
- anchors: 同幅・異高入力（レスポンシブ縦伸び）の位置整合検査（省略可）。各要素 {x,y,width,height,mode,label?,tolerancePx?} を design 画像のピクセル座標で宣言する。mode は top-ratio（上端を高さ比で写像）または bottom-fixed（下端固定）。tolerancePx 既定2。宣言領域を screenshot 内で同定し、期待位置とのズレが許容内かをアンカー毎に PASS/FAIL で返す。未指定時は従来どおりピクセル比較のみ
- local_alignment_tolerance_px: 採点領域ごとの局所平行移動の許容上限（省略可、opt-in）。指定した場合、structure が閾値未満の領域で ±N px の再整列を試し、整列後に構造 0.95 以上なら位置ずれを minor issue として採点に残す。ラスタライザ差・丸め誤差による数pxのズレ向け（例: Figma 正本 vs Flutter/Skia 実測）。未指定時は 1px の座標差でも従来どおり FAIL を維持する
- rasterization_tolerance: same-token-rasterization 分類を合否に効かせるか（省略可、opt-in、既定 false）。領域の全画素が共通 bg→fg 軸上のブレンドで前景トークン・トポロジ・インク量が一致すると4拘束で証明された領域を「同一内容物のラスタライザ差」として採点する。別描画エンジン同士の比較 (Figma 正本 vs Flutter/Skia 実測) で文字列のストローク被覆差を実害と区別する向け。証明は平行移動に不変なので、内容物が数pxずれていても合否は通る。ずれ量は same_token_content_offset の position issue (1.5px 以上 minor、3.5px 以上 major) として返るので、位置を詰める場合はこの issue を見る。1-5px幅の枠線・区切り線が±3px以内で平行移動しただけと証明された領域も色の critical にせず、local_displacement の minor position issue としてずれ量を返す。未指定時は分類証拠がレポートに残るだけで合否は従来どおり
- mask_system_ui: モバイル実機/Simulator撮影のOSステータスバー/ナビゲーションバーを自動マスクするか。capture_device指定時は既定true、それ以外は既定false。set_ignore_regionsで追加の微調整が可能
- auto_mask_dynamic: screenshot_url経路で同じページを2回撮り、変わった領域を自動マスクする（既定true）。時計/カウンタ/カルーセル等が毎回差分に出て収束しなくなるのを防ぐ

## 実機スクショの帯
capture_device 指定時は、画面上下のべた塗り帯（開発時のトースト/スナックバーの可能性）を検出し、set_ignore_regions のコマンド付きで候補として出します。自動では除外しません。デザイン側にも同じ帯がある場合は意図した要素なので、マスクしないでください。

## Figma URLの例
  "https://www.figma.com/design/ABC123/File?node-id=1-23"
  "https://www.figma.com/design/ABC123/File"

## ローカルパスの例
  "./design/home.png"
  "./screenshots/home.png"

ローカルの design_source はカレントディレクトリまたは ~/.figdiff/cache 配下に置くか、FIGDIFF_ALLOWED_DIRS で許可ディレクトリを追加してください。screenshot のローカルパスはこの allowlist の対象外です。

## 停止判定 (loopGuard)

compare_design は自走ループの停止判定を loopGuard として返します。呼び出し側は loopGuard.stop の真偽だけを判定材料にしてください。matchRate や status を勝手に再解釈してはいけません。

maxSteps の既定値は 10 です。stop === true になったら、それ以上 compare_design を呼ばずに人間へ報告してください。

~~~json
{
  "loopGuard": {
    "stop": false,
    "step": 1,
    "maxSteps": 10,
    "remainingSteps": 9,
    "reason": "continue",
    "message": "反復 1/10 回。改善の余地があるため修正を続行できます。",
    "iteration": 1,
    "decision": "continue"
  }
}
~~~

reason は次のいずれかです:
- no-regression: PASS に到達 (成功、ループ終了)
- regression: 悪化・停滞・同一結果 (修正が効いていない、または逆効果)
- max-steps: 反復上限 (10 回) に達した
- uncertain: 判定が UNCERTAIN (人間レビューが必要)
- continue: まだ続行可能`;

const CONFIDENCE_TO_PERCENTAGE = 100;

const buildDiagnosisLines = (result: CompareDesignResult, hasPriorLines: boolean): string[] => {
  if (!result.diagnosis) {
    return [];
  }
  const lines: string[] = hasPriorLines ? [""] : [];
  lines.push(result.diagnosis.headline);
  if (result.diagnosis.likelyMisconfig && result.diagnosis.rankedCauses.length > 0) {
    lines.push("", "推定原因（確度順）:");
    for (const cause of result.diagnosis.rankedCauses) {
      lines.push(
        `- [${Math.round(cause.confidence * CONFIDENCE_TO_PERCENTAGE)}%] ${cause.message} → ${cause.suggestedFix}`,
      );
    }
  }
  return lines;
};

const buildPreflightWarningLines = (result: CompareDesignResult): string[] => {
  const warnings = result.preflight?.warnings ?? [];
  if (warnings.length === 0) {
    return [];
  }
  const lines: string[] = ["", "Pre-flight 警告:"];
  for (const warning of warnings) {
    const fix = warning.suggestedFix ? ` → ${warning.suggestedFix}` : "";
    lines.push(`- [${warning.severity}] ${warning.message}${fix}`);
  }
  return lines;
};

const buildNormalizationLines = (result: CompareDesignResult): string[] => {
  if (!result.normalization) {
    return [];
  }
  const { designNativeWidth, designNativeHeight, screenshotWidth, screenshotHeight, appliedScale } =
    result.normalization;
  const lines: string[] = [
    "",
    `画像サイズ: design ${designNativeWidth}×${designNativeHeight} / screenshot ${screenshotWidth}×${screenshotHeight} / scale ${appliedScale.toFixed(2)}`,
  ];
  const ratio = screenshotWidth > 0 ? designNativeWidth / screenshotWidth : 1;
  if (ratio < 0.9 || ratio > 1.1) {
    lines.push(`  解像度差 約${ratio.toFixed(2)}x を正規化（軽微なボケが diff に乗る可能性）`);
  }
  const paddingRows = result.normalization.screenshotBottomPaddingRows;
  if (paddingRows !== undefined && paddingRows > 0) {
    lines.push(
      `  幅が一致しているため縮小せず上端揃えで比較し、design だけにある下端 ${paddingRows}px をスクリーンショットに無い行として差分に数えました`,
    );
  }
  if (result.normalization.autoCropped) {
    lines.push(
      `  スクリーンショットがdesignフレーム高を超えていたため、自動でフレーム範囲 (${designNativeWidth}×${designNativeHeight}) にcropして比較しました`,
    );
  }
  return lines;
};

const PERCENT_SCALE = 100;

// 警告を JSON の suggestion にだけ載せると、人間とエージェントが読むサマリーには
// 「差分はほぼありません」「ループを終了してください」しか出ず、ぼかし半径差を
// 照合したい場面で PASS をそのまま信じてしまう (designdiff#218)。
// status は変えずに、件数と再確認の手段をサマリー側にも出す。
const buildSubThresholdLines = (result: CompareDesignResult): string[] => {
  const subThreshold = result.subThresholdDiffPixelCount ?? 0;
  if (result.diffPixelCount !== 0 || subThreshold <= 0) {
    return [];
  }
  const ratio =
    result.totalPixelCount > 0
      ? ` (採点対象 ${result.totalPixelCount} px の ${((subThreshold / result.totalPixelCount) * PERCENT_SCALE).toFixed(2)}%)`
      : "";
  // 「ループ判定が最終決定」がツール契約の最優先ルール。停止と出ているのに
  // 「再比較してください」と並ぶと、守るべき指示が読み手に伝わらない。
  // 判定の取得失敗も停止として扱う契約に合わせ、停止時は人間への報告へ振る。
  const stop =
    result.loopGuard === undefined ||
    (result.loopGuard.stop ?? result.loopGuard.decision === "stop");
  const guidance = stop
    ? "  ループ判定が 停止 のため再呼出しはできません。ぼかし半径・グラデーションの照合が目的なら、この警告を人間に報告してください（人間側で threshold を下げた再比較が可能です）。"
    : "  影のぼかし半径やグラデーションの一致を確かめる目的なら、threshold を下げて (例: 0) 再比較するか差分を目視で確認してください。";
  return [
    "",
    `threshold 未満の差分画素: ${subThreshold} px${ratio}`,
    "全差分が threshold 未満の低振幅差分です（影のぼかし・グラデーション・微細な色ズレの可能性）。",
    guidance,
  ];
};

// 構造SSIM判定の行は日本語本文の中で内部トークンだけを大文字で出しても非開発者に
// 判定が伝わらない (#256)。日本語を先頭にし、エージェントがサマリーから判定を拾える
// ようトークンを括弧に残す。
// aggregateVerdict は構造面の部分判定でしかなく、pass でも token/anchor 違反や
// 設定ミス疑いで status は FAIL / UNCERTAIN になり得るし、fail でも UNCERTAIN に
// 倒れることがある。「完成」「要修正」と書くと status と矛盾した指示になるので、
// pass / fail は構造差の有無だけを述べる。inconclusive は status が必ず UNCERTAIN に
// なるため、直さず報告する運用をこの行にも書いてよい。
const VERDICT_DISPLAY: Record<DiffVerdict, string> = {
  pass: "構造差なし (PASS)",
  fail: "構造差あり (FAIL)",
  inconclusive: "判定不能 (INCONCLUSIVE)。失敗ではないので直そうとせず人間に報告",
};

// 並び順は「結論 → 原因 → 内訳 → 警告」。AI/ユーザーが最初の数行で
// 「実差分か設定ミスか」を即断でき、likely_misconfig の時だけ確度順に原因を
// 列挙して最優先の対処に誘導するため、この順序と簡潔な箇条書き形式にしている。
export const buildSummaryText = (result: CompareDesignResult): string => {
  const lines: string[] = [];

  lines.push(...buildLoopGuardLines(result));
  if (result.comparisonConditions) {
    lines.push("", result.comparisonConditions.message);
  }
  lines.push(...buildTokenDiffLines(result));

  if (result.diffReport) {
    if (lines.length > 0) lines.push("");
    lines.push(`構造SSIM判定: ${VERDICT_DISPLAY[result.diffReport.aggregateVerdict]}`);
    lines.push(result.diffReport.rationale);
  }

  lines.push(...buildDiagnosisLines(result, lines.length > 0));

  if (result.comparisonHeadline) {
    lines.push("", result.comparisonHeadline.headline);
  }

  lines.push(...buildSubThresholdLines(result));
  lines.push(...buildPreflightWarningLines(result));
  lines.push(...buildNormalizationLines(result));
  lines.push(...buildAnchorCheckLines(result));
  lines.push(...buildToastBandLines(result));
  lines.push(...buildMaskCandidateLines(result));

  return lines.join("\n");
};

// 停止判定を見落とすと、止まるべきループが不要な反復を続ける。サマリーの最初の1行に置く。
// 末尾では長い出力に埋もれて同じ状態に戻る。
const buildLoopGuardLines = (result: CompareDesignResult): string[] => {
  const guard = result.loopGuard;
  // compare_design は必ず停止判定を評価するので、undefined は「評価に失敗した」を意味する
  // (状態ファイルが書けない等)。黙って行を落とすと停止判定が見えない元の状態に戻るため、
  // 失敗した事実を出して人間の判断へ回す。
  if (!guard) {
    return [
      "ループ判定: 取得できません (停止判定の評価に失敗しました)",
      "自動修正を続けず、現状を人間に報告してください。~/.figdiff/loop-state/ に書き込めない可能性があります。",
    ];
  }

  // 旧フィールドが来ても動くよう、新しい `stop` / `step` / `maxSteps` を優先しつつ
  // `decision` / `iteration` はフォールバックに使う。
  const stop = guard.stop ?? guard.decision === "stop";
  const step = guard.step ?? guard.iteration ?? 1;
  const maxSteps = guard.maxSteps ?? step + (guard.remainingSteps ?? 0);
  const verdict = stop ? "停止" : "続行";
  // 上限を超えた step で "6/5" のような分数を出さない。上限は続行中だけ残量目安となる。
  const progress = stop
    ? `反復 ${step} 回目`
    : `反復 ${step} 回目 / 上限 ${maxSteps} 回 (残り ${guard.remainingSteps ?? Math.max(0, maxSteps - step)} 回)`;
  // 旧形式のテストデータなどで message が無い場合は reason をそのまま表示する。
  const message = guard.message ?? guard.reason;
  // 区切りの空行は後続セクションが自分の前に足す規約なので、ここでは足さない。
  return [`ループ判定: ${verdict} (${progress})`, message];
};

// 色と文字は画素やなく値そのもので比べられる。どちらの経路で判定したかを必ず出す。
// 出さんと、画素経路へ静かに落ちとることに読み手が気づけへん。
const buildTokenDiffLines = (result: CompareDesignResult): string[] => {
  const report = result.tokenDiff;
  if (!report) return [];

  const lines: string[] = ["", `判定経路: ${result.verdictRoute ?? "pixel"}`];
  if (!report.reliable) {
    lines.push(
      `色・文字の値による判定は使いませんでした。${report.demotionReason ?? ""}`.trim(),
      "この比較では色も画素経路で見ています。文字の縁のぼかしに埋もれる程度の色差は捕まえられません。",
    );
    return lines;
  }

  const blocking = report.mismatches.filter((mismatch) => mismatch.severity === "critical");
  lines.push(
    `色・文字の値: ${report.matchedNodeCount} ノード / ${report.checkedPropertyCount} 項目を突き合わせ (未照合 ${report.unmatchedNodeCount} ノード)`,
  );
  if (report.mismatches.length === 0) {
    lines.push("食い違いはありません。");
    return lines;
  }

  for (const mismatch of report.mismatches.slice(0, 10)) {
    const mark = mismatch.severity === "critical" ? "要修正" : "参考";
    const where = mismatch.region ? ` @ (${mismatch.region.x}, ${mismatch.region.y})` : "";
    lines.push(
      `- [${mark}] ${mismatch.nodeName} の ${mismatch.property}: 設計 ${mismatch.designValue} / 実装 ${mismatch.implValue}${where}`,
    );
  }
  if (report.mismatches.length > 10) {
    lines.push(`- ほか ${report.mismatches.length - 10} 件`);
  }
  if (blocking.length > 0) {
    lines.push(
      "要修正の項目は値が確定しているので、推測せずこの値へ直してください。参考の項目は合否を落としません。",
    );
  }
  return lines;
};

// 位置規則の違反は画素差とは別の根拠なので、
// アンカー毎に期待位置と実位置を並べて出す。anchors 未指定の比較では出さない。
const buildAnchorCheckLines = (result: CompareDesignResult): string[] => {
  const report = result.anchorCheck;
  if (!report) return [];

  if (!report.evaluated) {
    return ["", `縦位置アンカー検査: 未評価 (${report.reason ?? "不明な理由"})`];
  }

  const lines = ["", `縦位置アンカー検査: ${report.verdict === "pass" ? "全件 PASS" : "違反あり"}`];
  for (const anchor of report.anchors) {
    const name = anchor.label ?? `(${anchor.region.x},${anchor.region.y})`;
    if (anchor.status === "unmatched") {
      lines.push(`  - [UNMATCHED] ${name} (${anchor.mode}): 領域を同定できませんでした`);
      continue;
    }
    const mark = anchor.status === "pass" ? "PASS" : "FAIL";
    lines.push(
      `  - [${mark}] ${name} (${anchor.mode}): 期待 y=${anchor.expectedY} / 実際 y=${anchor.matchedY} / ズレ ${anchor.offsetPx}px (許容 ${anchor.tolerancePx}px)`,
    );
  }
  return lines;
};

// 実機スクショの帯 (開発時のトースト等) は、比較対象の画面と無関係やのに
// 毎回差分に乗る。自動では消さず、そのまま貼れるコマンドとして提案する。
const buildToastBandLines = (result: CompareDesignResult): string[] => {
  const candidates = result.toastBandCandidates ?? [];
  if (candidates.length === 0) return [];

  const lines = [
    "",
    "帯のマスク候補（実機のトースト/スナックバーの可能性・自動では除外していません）:",
  ];
  for (const [index, candidate] of candidates.entries()) {
    const where = candidate.position === "top" ? "画面上部" : "画面下部";
    lines.push(
      `  - ${where} {x:${candidate.x},y:${candidate.y},w:${candidate.width},h:${candidate.height}} (周囲との明るさの差 ${candidate.contrast})`,
    );
    lines.push(
      `    → set_ignore_regions(label:"device-band-${index + 1}", x:${candidate.x}, y:${candidate.y}, width:${candidate.width}, height:${candidate.height})`,
    );
  }
  lines.push("  デザイン側にも同じ帯がある場合は、意図した要素なのでマスクしないでください。");
  return lines;
};

const buildMaskCandidateLines = (result: CompareDesignResult): string[] => {
  const report = result.diffReport;
  if (!report || report.aggregateVerdict === "pass") return [];

  const candidates = report.regionScores
    // 比較対象そのものの行は画面全体を覆う。写真の多い画面で候補に入ると、
    // 「画面全部を無視しろ」という案内になり、あらゆる崩れが隠れる。
    .filter((r) => r.scope !== "root")
    .filter((r) => (r.textureScore ?? 0) > 0.5 || (r.structure >= 0.9 && r.color < 0.7));

  if (candidates.length === 0) return [];

  const lines = [
    "",
    "マスク候補（自動では除外していません。内容を確認し、採否は利用者が判断してください）:",
  ];
  for (const c of candidates) {
    const reason =
      (c.textureScore ?? 0) > 0.5
        ? `texture=${(c.textureScore ?? 0).toFixed(2)} (画素の変化が細かい領域。文章やボタンも含まれ得るため、写真とは判定していません)`
        : `structure=${c.structure.toFixed(2)} / color=${c.color.toFixed(2)} (構造が近く色が異なる領域。意図した差か確認してください)`;
    lines.push(
      `  - ${c.regionId}: {x:${c.bbox.x},y:${c.bbox.y},w:${c.bbox.w},h:${c.bbox.h}} (${reason})`,
    );
    lines.push(
      `    → set_ignore_regions(label:"${c.regionId}-intentional", x:${c.bbox.x}, y:${c.bbox.y}, width:${c.bbox.w}, height:${c.bbox.h})`,
    );
  }
  return lines;
};

export const registerCompareDesign = (server: McpServer): void => {
  const inputSchema = {
    figma_contents_only: z
      .boolean()
      .optional()
      .describe(
        "Figma 書き出しで対象ノードの内容だけを含める（既定 false）。false はノード自身の背景塗りに加えて、対象ノードと重なる周辺レイヤーも書き出す。背景塗りを含めないと実装側の実際の背景との偽差分が出るため既定は false だが、比較対象外の重なりが基準に入る場合は true を指定する。true は背景塗りを落とすため、未指定 (design_background 省略) の完全透明画素は採点から外れる。",
      ),
    figma_use_absolute_bounds: z
      .boolean()
      .optional()
      .describe(
        "Figma 書き出しにノード全体の境界を使う（既定 true）。false は描画内容の境界を使う。非表示ノードの空白出力を調べる場合も、取得できた画像に設計内容があるか確認する。",
      ),
    campaign_id: ComparisonCampaignIdSchema.optional().describe(
      "修正キャンペーンのID（1〜128文字）。同じ作業では同じIDで履歴を継続し、新しい作業では別IDで初回から始める。省略時は従来どおり対象単位の履歴を使う。過去の比較証跡は削除しない。",
    ),
    design_source: z
      .string()
      .describe(
        "FigmaのURL（node-id付き推奨）またはデザイン画像のローカルパス。ローカル画像はカレントディレクトリまたは ~/.figdiff/cache 配下、または FIGDIFF_ALLOWED_DIRS で追加した許可ディレクトリ配下に置く。",
      ),
    screenshot: z
      .string()
      .optional()
      .describe(
        "実装スクリーンショットのローカルパス（screenshot_url / capture_device 使用時は省略可）",
      ),
    screenshot_url: z
      .string()
      .url()
      .optional()
      .describe(
        "撮影対象のURL。指定時はPlaywrightで内部撮影し、screenshotの代わりに使用する。screenshot / screenshot_url / capture_device のいずれか一つを指定。別ネットワーク環境（WSL/サンドボックス）でlocalhost到達が失敗する場合は環境変数FIGDIFF_CDP_ENDPOINTにホストChromeのCDPアドレスを設定してください。",
      ),
    capture_device: z
      .enum(["android", "ios-sim", "ios-device"])
      .optional()
      .describe(
        "接続済みモバイル端末/SimulatorからPNGを撮影し、screenshotの代わりに使用する。android=adb、ios-sim=xcrun simctl、ios-device=pymobiledevice3。",
      ),
    capture_device_serial: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        "撮影対象のAndroid端末serial。capture_device: androidと併用。省略時はANDROID_SERIALまたは単一の接続端末を使用し、複数なら選択を求める。",
      ),
    capture_scroll: z
      .boolean()
      .optional()
      .describe(
        "capture_device 経路で、1画面に収まらん画面をスクロールしながら撮って縦長1枚へ繋ぐ。既定false。繋いだ内訳（何枚繋いだか・下端まで届いたか）は scrollCapture に返る。",
      ),
    capture_width: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "撮影幅(px)。省略時はFigmaフレームの実幅を自動取得。screenshot_url指定時のみ有効。",
      ),
    comparison_conditions: ComparisonConditionsInputSchema.optional().describe(
      "両画像の表示領域・倍率・共通原点の申告。各sideはviewport{width,height}(論理px), pixelRatio(物理px/論理px), origin{x,y}(画像左上の共通参照座標、論理px)。画像の移動・cropには使用しない。",
    ),
    mask_system_ui: z
      .boolean()
      .optional()
      .describe(
        "モバイル実機/Simulator撮影のOSステータスバー/ナビゲーションバーを自動ignore_regions化する。capture_device指定時は既定true、それ以外は既定false。",
      ),
    auto_mask_dynamic: z
      .boolean()
      .optional()
      .describe(
        "screenshot_url経路で同じページを2回撮り、撮るたびに変わる領域(時計/カウンタ/カルーセル/ランダム広告)を自動でignore_regions化する。既定true。falseにすると2回目の撮影を行わない。",
      ),
    token_diff: z
      .boolean()
      .optional()
      .describe(
        "screenshot_url + Figma URL の組み合わせで、色・フォントを画素ではなく値そのもので突き合わせる。既定true。対応付けできない割合が高い場合は自動で画素経路へ戻る。判定に使った経路は verdictRoute に出る。",
      ),
    frame_name: z
      .string()
      .optional()
      .describe("Figma URLにnode-idが含まれない場合のフレーム名（省略可）"),
    threshold: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe(
        "色差の許容閾値（0-1）。直接指定時は profile より優先される。省略時は profile の値か 0.1。",
      ),
    design_background: z
      .string()
      .regex(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "design_background must be a hex color")
      .optional()
      .describe(
        "透明画素を合成する色（#RRGGBB、既定は白）。figma_contents_only: true の書き出しで省略したときだけ、完全透明な設計画素（背景未指定）を構造採点から外す。それ以外の省略時は従来どおり白を敷いて採点するため、ローカル PNG の意図的な透明の穴も検出対象のまま残る。指定時は常にその色の上で採点する。",
      ),
    profile: z
      .enum(["strict", "balanced", "layout"])
      .optional()
      .describe(
        "比較プロファイル。strict=完全一致(threshold 0)、balanced=通常(threshold 0.1、省略時のデフォルト)、layout=構造のみ(threshold 0.4)。threshold を直接指定した場合はそちらが優先される。",
      ),
    project_id: z
      .string()
      .regex(/^[a-zA-Z0-9_-]+$/, "Project ID must be alphanumeric with hyphens/underscores only")
      .optional()
      .describe(
        "Crop Region・保存済み ignore_regions・前回使用ノードの自動補完に使うプロジェクトID（省略可）",
      ),
    ignore_regions: z
      .array(IgnoreRegionSchema)
      .optional()
      .describe(
        "意図的差分マスク。project_id指定時は保存済みマスクと結合される。各矩形{x,y,width,height,label?}内のピクセルは差分検出/matchRate分母から除外。座標系はcrop適用後のscreenshotピクセル座標。",
      ),
    anchors: z
      .array(AnchorRegionSchema)
      .optional()
      .describe(
        "同幅・異高入力（レスポンシブ縦伸び）の位置整合検査。design_source画像のピクセル座標で宣言した領域{x,y,width,height}を screenshot 内で同定し、mode の位置規則 (top-ratio=上端を高さ比で写像 / bottom-fixed=下端固定) を tolerancePx(既定2) 内で検査する。アンカー毎の PASS/FAIL は anchorCheck に返り、違反があれば status は FAIL になる。未指定時は従来どおりピクセル比較のみ。",
      ),
    local_alignment_tolerance_px: z
      .number()
      .int()
      .min(0)
      .max(10)
      .optional()
      .describe(
        "採点領域ごとの局所平行移動の許容上限 (px)。指定すると、structure が閾値未満の領域に対して ±N px の再整列を試し、整列後に構造 0.95 以上なら「同じ内容物の位置ずれ」として採点する (整列後の残差色が glyph-edge と分類される場合のみ色差 critical を minor に格下げし、位置ずれ自体は必ず minor issue としてレポートに残る)。ラスタライザ差・丸め誤差で要素が数pxずれる環境間比較 (例: Figma 正本 vs Flutter/Skia 実測) 向けの opt-in 許容。未指定時は従来どおり 1px の座標差でも FAIL を維持する。",
      ),
    rasterization_tolerance: z
      .boolean()
      .optional()
      .describe(
        "same-token-rasterization 分類を合否に効かせるかの opt-in (既定 false)。領域内の全画素が共通 bg→fg 軸上のブレンドであり前景トークン・トポロジ (Hausdorff)・インク量が一致すると4拘束で証明された領域を「同一内容物のラスタライザ差」として採点する (構造・色誤差を解消済みにし critical を minor へ)。別描画エンジン同士の比較 (Figma 正本 vs Flutter/Skia 実測など) で、同じトークンで描かれた文字列のストローク被覆差を実害と区別するための許容。証明は平行移動に不変なので数pxの位置ずれは合否に効かず、ずれ量は same_token_content_offset の position issue (1.5px 以上 minor、3.5px 以上 major) として返る。未指定時は分類証拠をレポートに残すだけで合否は従来どおり。",
      ),
  };

  server.registerTool(
    "compare_design",
    {
      description: DESCRIPTION,
      inputSchema,
      outputSchema: CompareDesignResultSchema,
    },
    async (args, extra) => {
      try {
        // strict schema では SDK の汎用エラーに変わるだけで誤記を案内できないため、
        // parse 前に transport が保存した引数名を shape と照合する。
        assertNoUnknownToolArguments("compare_design", Object.keys(inputSchema), extra);
        // 永続化を伴う比較を始める前に全保存先を検査する。途中で EPERM が出ると
        // 履歴や差分画像だけが残り、次回のループ判定へ不完全な記録が混ざる。
        await assertFigdiffStorageWritable();
        const comparison = await runCompareDesign(args);
        const result = comparison.result;

        const allRegions = result.diffRegions ?? [];
        const sortedRegions = [...allRegions].sort(
          (a, b) => (b.diffPixelCount ?? 0) - (a.diffPixelCount ?? 0),
        );
        const truncated = sortedRegions.length > MAX_INLINE_DIFF_REGIONS;
        const inlineRegions = truncated
          ? sortedRegions.slice(0, MAX_INLINE_DIFF_REGIONS)
          : sortedRegions;
        const regionsDetailPath = truncated
          ? await persistDetailJson(sortedRegions, `${result.comparisonId}.regions`)
          : undefined;

        const resultData = CompareDesignResultSchema.parse({
          ...result,
          diffImagePath: result.diffImagePath,
          diffImageBase64: undefined,
          diffRegions: inlineRegions,
          totalRegionCount: allRegions.length,
          returnedRegionCount: inlineRegions.length,
          regionsTruncated: truncated,
          regionsDetailPath,
        });

        try {
          const designImagePath =
            comparison.parsedDesignSource.type === "local_path"
              ? comparison.parsedDesignSource.filePath
              : undefined;
          await writeActiveSession({
            comparisonId: resultData.comparisonId,
            // 比較対象そのものを指す鍵。comparisonId を入れると毎回別対象に見えて、
            // 「同じ画面を直し続けとる」ことが後から辿れんようになる。
            sourceKey: comparison.sourceKey,
            implementationUrl: args.screenshot_url ?? undefined,
            designSource: args.design_source,
            designImagePath,
            matchRate: resultData.matchRate,
            status: resultData.status ?? "FAIL",
            updatedAt: Date.now(),
          });
        } catch {
          // non-critical
        }

        const content: { type: "text"; text: string }[] = [];

        // 互換性のため最初の text ブロックは JSON のまま維持し、
        // 確信度レイヤーの人間可読サマリ（設定ミス診断・構造/色分離・警告）は末尾に置く。
        const slimResultData = {
          ...resultData,
          gridSummary: undefined,
          diffReport: undefined,
        };

        content.push({
          type: "text",
          text: JSON.stringify(slimResultData, null, 2),
        });

        const summaryText = buildSummaryText(result);
        const hintLine = `全差分レポート（gridSummary/diffReport含む）は generate_diff_report(comparison_id="${result.comparisonId}") で取得可能。`;
        const fullSummary = summaryText.length > 0 ? `${summaryText}\n\n${hintLine}` : hintLine;
        content.push({ type: "text", text: fullSummary });

        return { content, structuredContent: slimResultData };
      } catch (error) {
        if (isFigdiffStorageError(error)) {
          const payload = toFigdiffStorageErrorPayload(error);
          return {
            content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
            isError: true,
          };
        }
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );
};
