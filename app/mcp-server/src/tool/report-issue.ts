import * as os from "node:os";

import { z } from "zod";

import { readActiveSession } from "../service/active-session.js";
import {
  createGithubService,
  formatGithubCredentialError,
  getGithubCredentialStatus,
  resolveIssueRepo,
  sanitizeForPublicIssue,
} from "../service/github-service.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const CATEGORY_LABEL_MAP: Record<string, string> = {
  bug: "bug",
  usability: "usability",
  enhancement: "enhancement",
  docs: "docs",
};

const CATEGORY_PREFIX_MAP: Record<string, string> = {
  bug: "[bug]",
  usability: "[usability]",
  enhancement: "[enhancement]",
  docs: "[docs]",
};

const ReportIssueOutputSchema = z.object({
  issueUrl: z.string(),
  issueNumber: z.number(),
  deduped: z.boolean(),
  maskedCount: z.number().describe("サニタイズで除去したフィールド数"),
});

const DESCRIPTION = `FigDiff の使いにくさ・バグ・改善要望を GitHub issue として起票します。

## いつ使うか
- compare_design / list_figma_frames 等のツールで「使いにくい」「期待通りに動かない」と感じた瞬間
- エラーメッセージが分かりにくい、ワークフローが2ステップ必要、結果が大きすぎてアーカイブされた等

## ⚠️ 公開リポジトリ注意
kouiso/designdiff は public リポジトリです。機微情報（内部 Figma URL・顧客データ・ローカルパス・トークン）を body に貼らないでください。ツール側でサニタイズしますが二重で確認してください。

## セットアップ
GITHUB_TOKEN が必要です。未設定の場合: export GITHUB_TOKEN=$(gh auth token)`;

export function registerReportIssue(server: McpServer): void {
  server.registerTool(
    "report_issue",
    {
      description: DESCRIPTION,
      inputSchema: {
        title: z.string().describe("issue タイトル（簡潔に）"),
        body: z.string().describe("issue 本文。再現手順・期待動作・実際の動作を含めてください"),
        category: z
          .enum(["bug", "usability", "enhancement", "docs"])
          .optional()
          .describe("issue カテゴリ（label + title prefix に使用）"),
        include_context: z
          .boolean()
          .optional()
          .describe(
            "active session の比較結果概要（matchRate/status/comparisonId）をフッターに自動添付（default: true）",
          ),
        include_design_source: z
          .boolean()
          .optional()
          .describe(
            "Figma URL / ローカルパスをフッターに添付（default: false）。public リポジトリへの投稿のため、有効化時も Figma キーはマスクされます",
          ),
        comparison_id: z
          .string()
          .optional()
          .describe(
            "compare_design の comparisonId。指定時は matchRate・region 数の数値概要のみを本文に添付（diff 画像・ローカルパスは含まず）",
          ),
      },
      outputSchema: ReportIssueOutputSchema,
    },
    async (args) => {
      try {
        const status = getGithubCredentialStatus();
        if (!status.valid) {
          return {
            content: [{ type: "text", text: `Error: ${formatGithubCredentialError(status)}` }],
            isError: true,
          };
        }

        const { owner, repo } = resolveIssueRepo();
        const githubService = createGithubService();

        const includeContext = args.include_context !== false;
        const includeDesignSource = args.include_design_source === true;

        const prefix = args.category ? `${CATEGORY_PREFIX_MAP[args.category]} ` : "";
        const rawTitle = `${prefix}${args.title}`;

        let rawBody = args.body;

        if (args.comparison_id) {
          rawBody += `\n\n---\n**比較ID**: \`${args.comparison_id}\`\n(matchRate / region 数は generate_diff_report で確認可能)`;
        }

        if (includeContext) {
          const session = await readActiveSession().catch(() => null);
          const platform = `${os.platform()} ${os.release()}`;
          const figdiffVersion = "0.1.0";
          let contextFooter = `\n\n---\n**Context**\n- figdiff: ${figdiffVersion}\n- platform: ${platform}`;
          if (session) {
            contextFooter += `\n- matchRate: ${session.matchRate}%\n- status: ${session.status}\n- comparisonId: ${session.comparisonId}`;
            if (includeDesignSource && session.designSource) {
              contextFooter += `\n- designSource: ${session.designSource}`;
            }
          }
          rawBody += contextFooter;
        }

        const titleSanitized = sanitizeForPublicIssue(rawTitle, includeDesignSource);
        const bodySanitized = sanitizeForPublicIssue(rawBody, includeDesignSource);
        const totalMasked = titleSanitized.maskedCount + bodySanitized.maskedCount;

        const labels: string[] = ["mcp-feedback"];
        if (args.category && CATEGORY_LABEL_MAP[args.category]) {
          labels.push(CATEGORY_LABEL_MAP[args.category]);
        }

        const issueResult = await githubService.createIssue({
          owner,
          repo,
          title: titleSanitized.text,
          body: bodySanitized.text,
          labels,
        });

        const output = ReportIssueOutputSchema.parse({
          issueUrl: issueResult.html_url,
          issueNumber: issueResult.number,
          deduped: issueResult.deduped,
          maskedCount: totalMasked,
        });

        const message = issueResult.deduped
          ? `既存 issue に重複: #${issueResult.number} ${issueResult.html_url}`
          : `issue #${issueResult.number} を起票しました: ${issueResult.html_url}${
              totalMasked > 0 ? ` (${totalMasked}件の機微情報をマスク済み)` : ""
            }`;

        return {
          content: [{ type: "text", text: message }],
          structuredContent: output,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
