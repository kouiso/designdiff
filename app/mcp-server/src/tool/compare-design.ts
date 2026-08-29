/**
 * compare_design — Primary MCP Tool
 * Pixel-level diff between Figma design and implementation screenshot.
 * AI should ALWAYS start with this tool.
 */

import { z } from "zod";

import {
  CompareDesignResultSchema,
  IgnoreRegionSchema,
  type CompareDesignResult,
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
- 判定経路: token-diff = 色とフォントを値そのもので突き合わせた。要修正の項目は設計側の値が確定しているので、そのまま直すこと。pixel = 値の突合が使えず画素だけで見た（理由が同じ欄に出る）。この場合フォントの縁のぼかしに埋もれる色差は検出できない
- status: "PASS" = 構造SSIM判定上の完了。"FAIL" = 修正が必要。"UNCERTAIN" = 判定の確からしさが足りず人間レビューへ回った状態。失敗ではないので直そうとせず報告すること
- completionCriteria: blocking=true の項目が "PASS" になるまで作業を続行。ただし status が "UNCERTAIN" の項目は直しても "PASS" にならないので、そこで止めて人間に報告する。matchRate は参考値
- nextAction: 次に実行すべきアクション（従うこと）
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
- ignore_regions: 既知の意図的差分マスク（省略可）。project_id の保存済みマスク、自動 system UI マスクと結合される。WP原文 vs Figmaプレースホルダ、Google Map埋め込み等の false-positive 抑制に使用。各矩形 {x,y,width,height,label?} 内のピクセルは差分検出/matchRate 分母から除外される
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
  if (result.normalization.autoCropped) {
    lines.push(
      `  スクリーンショットがdesignフレーム高を超えていたため、自動でフレーム範囲 (${designNativeWidth}×${designNativeHeight}) にcropして比較しました`,
    );
  }
  return lines;
};

// 並び順は「結論 → 原因 → 内訳 → 警告」。AI/ユーザーが最初の数行で
// 「実差分か設定ミスか」を即断でき、likely_misconfig の時だけ確度順に原因を
// 列挙して最優先の対処に誘導するため、この順序と簡潔な箇条書き形式にしている。
export const buildSummaryText = (result: CompareDesignResult): string => {
  const lines: string[] = [];

  lines.push(...buildLoopGuardLines(result));
  lines.push(...buildTokenDiffLines(result));

  if (result.diffReport) {
    if (lines.length > 0) lines.push("");
    lines.push(`構造SSIM判定: ${result.diffReport.aggregateVerdict.toUpperCase()}`);
    lines.push(result.diffReport.rationale);
  }

  lines.push(...buildDiagnosisLines(result, lines.length > 0));

  if (result.comparisonHeadline) {
    lines.push("", result.comparisonHeadline.headline);
  }

  lines.push(...buildPreflightWarningLines(result));
  lines.push(...buildNormalizationLines(result));
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

  const lines = ["", "マスク候補（意図的差分の可能性・採否はAIループが判断）:"];
  for (const c of candidates) {
    const reason =
      (c.textureScore ?? 0) > 0.5
        ? `texture=${(c.textureScore ?? 0).toFixed(2)} (写真/画像領域)`
        : `structure=${c.structure.toFixed(2)} / color=${c.color.toFixed(2)} (意図的な色差)`;
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
        "背景の塗りが無いFigmaノードを、どの色の上に置いて評価するか（#RRGGBB、既定は白）。実装側の画面が白地でない場合に指定する。",
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
            structuredContent: payload,
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
