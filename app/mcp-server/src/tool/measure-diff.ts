/**
 * measure_diff — 寸法・余白を数値で突き合わせるツール。
 *
 * compare_design (画素) とは別のツールとして足している。画素の経路は
 * 「壊していないか」を見るのが得意で、15px と 16px の文字の差はほとんど出ない。
 * どちらかに寄せるのではなく、用途で使い分ける。
 */

import { z } from "zod";

import { extractFileKey, extractNodeId, normalizeNodeId } from "@figdiff/shared";
import type { MeasureDiffReport } from "@figdiff/shared";

import { captureUrl } from "../service/capture-service.js";
import { createFigmaService } from "../service/figma-service.js";
import { runMeasureDiff } from "../service/measure-diff-service.js";
import { persistDetailJson } from "../service/persist-detail.js";

import { mcpToolError } from "./error.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DESCRIPTION = `デザインと実装の「寸法・余白・文字の大きさ」を数値で突き合わせます。

## compare_design との使い分け
- compare_design (画素): 壊していないかの回帰検知。得意
- measure_diff (数値): font-size 15px→16px、gap 12px→16px のような値のズレ。画素では埋もれる

## 出力の読み方
- mismatches: 「デザインの値 → 実装の値 (差)」。差の大きい順。implRef / implTag / implRect で実装の該当箇所を探す
- unmatchedDesignNodes: 対応がつかなかったデザインノード。件数で丸めず1件ずつ名前で出す。ここが多い時は結果全体を信じない
- stackChecks: 積み上げの検算。verified=false の親は、その中に勘定へ入っていない要素がある
- reliable: false の時は demotionReason を読む。座標系がずれている疑いがある状態で数値だけ見てはいけない
- skipped: 比較しなかった項目とその理由

## 入力
- design_source: Figma URL（node-id付き）
- screenshot_url: 実装のURL。DOM の実測が要るので、静止画では代替できない
- capture_width: 撮影幅(px)。省略時は Figma フレームの実幅`;

const MAX_INLINE_MISMATCHES = 30;
const MAX_INLINE_UNMATCHED = 20;
const MAX_INLINE_STACK_FAILURES = 15;

function formatMismatchLine(mismatch: MeasureDiffReport["mismatches"][number]): string {
  const sign = mismatch.deltaPx > 0 ? "+" : "";
  return `- [${mismatch.severity}] ${mismatch.property}: ${mismatch.designPx} → ${mismatch.implPx} (${sign}${mismatch.deltaPx}px) | ${mismatch.nodeName} (${mismatch.nodeId}) | 実装 <${mismatch.implTag}> ref=${mismatch.implRef} @ ${mismatch.implRect.x},${mismatch.implRect.y} ${mismatch.implRect.w}x${mismatch.implRect.h}`;
}

function buildSummary(report: MeasureDiffReport, detailPath: string): string {
  const lines: string[] = [];
  lines.push(
    `デザイン ${report.designNodeCount} ノード / 対応付け ${report.matchedNodeCount} / 未対応 ${report.unmatchedNodeCount} (${Math.round(
      report.unmatchedRatio * 100,
    )}%) / 比較項目 ${report.checkedPropertyCount} / 倍率 ${report.scale.toFixed(3)}`,
  );
  lines.push(
    report.reliable
      ? "判定: この結果は数値の根拠として使えます。"
      : `判定: 使えません — ${report.demotionReason ?? "理由不明"}`,
  );

  lines.push("", `ズレ ${report.mismatches.length} 件`);
  if (report.mismatches.length === 0) {
    lines.push("- なし");
  } else {
    for (const mismatch of report.mismatches.slice(0, MAX_INLINE_MISMATCHES)) {
      lines.push(formatMismatchLine(mismatch));
    }
    if (report.mismatches.length > MAX_INLINE_MISMATCHES) {
      lines.push(
        `- (残り ${report.mismatches.length - MAX_INLINE_MISMATCHES} 件は detailPath の JSON を参照)`,
      );
    }
  }

  lines.push("", `対応がつかなかったデザインノード ${report.unmatchedDesignNodes.length} 件`);
  if (report.unmatchedDesignNodes.length === 0) {
    lines.push("- なし");
  } else {
    for (const unmatched of report.unmatchedDesignNodes.slice(0, MAX_INLINE_UNMATCHED)) {
      lines.push(
        `- ${unmatched.nodeName} (${unmatched.nodeId} / ${unmatched.nodeType}) @ ${unmatched.rect.x},${unmatched.rect.y} ${unmatched.rect.w}x${unmatched.rect.h} — ${unmatched.reason}`,
      );
    }
    if (report.unmatchedDesignNodes.length > MAX_INLINE_UNMATCHED) {
      lines.push(
        `- (残り ${report.unmatchedDesignNodes.length - MAX_INLINE_UNMATCHED} 件は detailPath の JSON を参照。件数で丸めていないので全件そこにある)`,
      );
    }
  }

  const stackFailures = report.stackChecks.filter((check) => !check.verified);
  lines.push(
    "",
    `積み上げの検算: ${report.stackChecks.length} 件中 ${report.stackChecks.length - stackFailures.length} 件が閉じた`,
  );
  for (const failure of stackFailures.slice(0, MAX_INLINE_STACK_FAILURES)) {
    lines.push(
      `- ${failure.nodeName} (${failure.nodeId} / ${failure.axis}): 残差 デザイン ${failure.designResidualPx}px / 実装 ${failure.implResidualPx}px${
        failure.note === undefined ? "" : ` — ${failure.note}`
      }`,
    );
  }

  if (report.skipped.length > 0) {
    lines.push("", "比較しなかった項目");
    for (const skipped of report.skipped) lines.push(`- ${skipped}`);
  }

  lines.push("", `detailPath: ${detailPath}`);
  return lines.join("\n");
}

export const registerMeasureDiff = (server: McpServer): void => {
  server.registerTool(
    "measure_diff",
    {
      description: DESCRIPTION,
      inputSchema: {
        design_source: z.string().describe("Figma の URL（node-id 付き）"),
        screenshot_url: z
          .string()
          .describe("実装のURL。DOM の実測が必要なため静止画では代替できない"),
        node_id: z
          .string()
          .optional()
          .describe("比較するフレームのノードID。省略時は URL から取る"),
        capture_width: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("撮影幅(px)。省略時は Figma フレームの実幅"),
      },
    },
    async (args) => {
      try {
        const fileKey = extractFileKey(args.design_source);
        const nodeId = args.node_id
          ? normalizeNodeId(args.node_id)
          : extractNodeId(args.design_source);
        if (!nodeId) {
          return {
            content: [
              {
                type: "text" as const,
                text: "node-id が取れません。design_source に node-id 付きの URL を渡すか node_id を指定してください。",
              },
            ],
            isError: true,
          };
        }

        const figmaService = await createFigmaService();
        const figmaRootNode = await figmaService.getNodeDetails(fileKey, nodeId);
        const frameWidth = figmaRootNode.absoluteBoundingBox?.width;
        if (frameWidth === undefined || !(frameWidth > 0)) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Figma フレームの幅が取れませんでした。node-id がフレームを指しているか確認してください。",
              },
            ],
            isError: true,
          };
        }

        const captureWidth = args.capture_width ?? Math.round(frameWidth);
        const captured = await captureUrl(args.screenshot_url, {
          width: captureWidth,
          collectLayoutBoxes: true,
        });
        if (!captured.layoutBoxes || captured.layoutBoxes.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "実装側の実測が採れませんでした。ページが表示されているか、撮影が成功しているかを確認してください。",
              },
            ],
            isError: true,
          };
        }

        const report = runMeasureDiff({
          figmaRootNode,
          domBoxes: captured.layoutBoxes,
          screenshotWidth: captured.width,
        });
        const detailPath = await persistDetailJson(
          { report, screenshotPath: captured.screenshotPath },
          `measure-${crypto.randomUUID()}`,
        );

        return {
          content: [{ type: "text" as const, text: buildSummary(report, detailPath) }],
        };
      } catch (error) {
        return mcpToolError(error);
      }
    },
  );
};
