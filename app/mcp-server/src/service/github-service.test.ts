import { expect, it } from "vitest";

import { sanitizeForPublicIssue as sharedSanitizeForPublicIssue } from "@figdiff/shared";
import {
  GithubService as SharedGithubService,
  createGithubService as sharedCreateGithubService,
  getGithubCredentialStatus as sharedGetGithubCredentialStatus,
  resolveIssueRepo as sharedResolveIssueRepo,
} from "@figdiff/shared/node/github-service";

import {
  createGithubService,
  getGithubCredentialStatus,
  GithubService,
  resolveIssueRepo,
  sanitizeForPublicIssue,
} from "./github-service.js";

it("preserves MCP report-issue service exports", () => {
  expect(sanitizeForPublicIssue).toBe(sharedSanitizeForPublicIssue);
  expect(GithubService).toBe(SharedGithubService);
  expect(createGithubService).toBe(sharedCreateGithubService);
  expect(getGithubCredentialStatus).toBe(sharedGetGithubCredentialStatus);
  expect(resolveIssueRepo).toBe(sharedResolveIssueRepo);
});
