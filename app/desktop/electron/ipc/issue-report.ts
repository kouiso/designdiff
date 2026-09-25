import { ipcMain } from "electron";
import { z } from "zod";

import {
  createIssueReportDraftService,
  type IssueReportDraftService,
} from "../service/issue-report-draft.js";

const IssueReportInputSchema = z.object({
  title: z.string().trim().min(1).max(256),
  body: z.string().trim().min(1).max(65_536),
  category: z.enum(["bug", "usability", "enhancement", "docs"]).optional(),
});
const DraftIdSchema = z.string().min(1).max(128);

export function registerIssueReportHandlers(
  service: IssueReportDraftService = createIssueReportDraftService(),
): void {
  ipcMain.handle("issue-report:prepare", (_event, input: unknown) =>
    service.prepare(IssueReportInputSchema.parse(input)),
  );
  ipcMain.handle("issue-report:submit", (_event, draftId: unknown) =>
    service.submit(DraftIdSchema.parse(draftId)),
  );
  ipcMain.handle("issue-report:discard", (_event, draftId: unknown) => {
    service.discard(DraftIdSchema.parse(draftId));
  });
}
