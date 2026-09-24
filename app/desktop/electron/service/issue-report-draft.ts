import { randomUUID } from "node:crypto";

import { sanitizeForPublicIssue } from "@figdiff/shared";
import {
  createGithubService,
  resolveIssueRepo,
  type CreateIssueOptions,
  type IssueResult,
  type OpenIssueSearchResult,
} from "@figdiff/shared/node/github-service";
import {
  detectForeignProjectNames,
  formatForeignProjectError,
  PRODUCT_SELF_NAMES,
} from "@figdiff/shared/node/public-issue-guard";

export type IssueReportCategory = "bug" | "usability" | "enhancement" | "docs";

export interface IssueReportInput {
  title: string;
  body: string;
  category?: IssueReportCategory;
}

export type IssueReportDuplicate =
  | { status: "found"; issueNumber: number; issueUrl: string }
  | { status: "none" };

export interface IssueReportPreview {
  draftId: string;
  repository: { owner: string; repo: string };
  title: string;
  body: string;
  labels: string[];
  maskedCount: number;
  duplicate: IssueReportDuplicate;
}

export interface IssueReportSubmitResult {
  issueUrl: string;
  issueNumber: number;
  deduped: boolean;
  maskedCount: number;
}

interface GithubIssueClient {
  searchOpenIssueByTitle(
    owner: string,
    repo: string,
    title: string,
  ): Promise<OpenIssueSearchResult>;
  createIssue(options: CreateIssueOptions): Promise<IssueResult>;
}

interface StoredDraft {
  readonly draftId: string;
  readonly repository: Readonly<{ owner: string; repo: string }>;
  readonly title: string;
  readonly body: string;
  readonly labels: readonly string[];
  readonly maskedCount: number;
  readonly expiresAt: number;
}

export interface IssueReportDraftService {
  prepare(input: IssueReportInput): Promise<IssueReportPreview>;
  submit(draftId: string): Promise<IssueReportSubmitResult>;
  discard(draftId: string): void;
}

interface IssueReportDraftServiceOptions {
  createClient?: () => GithubIssueClient;
  resolveRepository?: () => { owner: string; repo: string };
  detectForeignNames?: typeof detectForeignProjectNames;
  createDraftId?: () => string;
  now?: () => number;
  ttlMs?: number;
  maxDrafts?: number;
}

const CATEGORY_PREFIX: Record<IssueReportCategory, string> = {
  bug: "[bug]",
  usability: "[usability]",
  enhancement: "[enhancement]",
  docs: "[docs]",
};

const DEFAULT_TTL_MS = 15 * 60 * 1_000;
const DEFAULT_MAX_DRAFTS = 32;
const MAX_GITHUB_ISSUE_TITLE_LENGTH = 256;

function canonicalGithubIssueUrl(owner: string, repo: string, issueNumber: number): string {
  if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
    throw new Error("GitHub returned an invalid issue number");
  }
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}`;
}

function buildTitle(input: IssueReportInput): string {
  return input.category ? `${CATEGORY_PREFIX[input.category]} ${input.title}` : input.title;
}

function buildLabels(category: IssueReportCategory | undefined): string[] {
  return category === undefined ? ["desktop-feedback"] : ["desktop-feedback", category];
}

function strictDuplicate(
  result: OpenIssueSearchResult,
  repository: { owner: string; repo: string },
): IssueReportDuplicate {
  if (result.status === "unavailable") {
    throw new Error(`GitHub duplicate lookup failed: ${result.message}`);
  }
  if (result.status === "none") return { status: "none" };
  return {
    status: "found",
    issueNumber: result.issue.number,
    issueUrl: canonicalGithubIssueUrl(repository.owner, repository.repo, result.issue.number),
  };
}

export function createIssueReportDraftService(
  options: IssueReportDraftServiceOptions = {},
): IssueReportDraftService {
  const createClient = options.createClient ?? createGithubService;
  const resolveRepository = options.resolveRepository ?? resolveIssueRepo;
  const findForeignNames = options.detectForeignNames ?? detectForeignProjectNames;
  const createDraftId = options.createDraftId ?? randomUUID;
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const maxDrafts = options.maxDrafts ?? DEFAULT_MAX_DRAFTS;
  const drafts = new Map<string, StoredDraft>();
  const inFlight = new Set<string>();

  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0)
    throw new Error("ttlMs must be a positive integer");
  if (!Number.isSafeInteger(maxDrafts) || maxDrafts <= 0) {
    throw new Error("maxDrafts must be a positive integer");
  }

  const removeExpired = (): void => {
    const current = now();
    for (const [draftId, draft] of drafts) {
      if (draft.expiresAt <= current && !inFlight.has(draftId)) drafts.delete(draftId);
    }
  };

  const readDraft = (draftId: string): StoredDraft => {
    removeExpired();
    const draft = drafts.get(draftId);
    if (!draft) throw new Error("Issue report draft was not found or has expired");
    return draft;
  };

  return {
    async prepare(input) {
      removeExpired();
      if (drafts.size >= maxDrafts) {
        throw new Error("Too many issue report drafts are awaiting review; discard one and retry");
      }

      const repository = resolveRepository();
      const titleResult = sanitizeForPublicIssue(buildTitle(input));
      const bodyResult = sanitizeForPublicIssue(input.body);
      if (titleResult.text.length > MAX_GITHUB_ISSUE_TITLE_LENGTH) {
        throw new Error(
          `Issue title exceeds ${MAX_GITHUB_ISSUE_TITLE_LENGTH} characters after adding its category`,
        );
      }
      const foreignNames = await findForeignNames(`${titleResult.text}\n${bodyResult.text}`, {
        selfNames: [repository.owner, repository.repo, ...PRODUCT_SELF_NAMES],
      });
      if (foreignNames.length > 0) throw new Error(formatForeignProjectError(foreignNames));

      const duplicateResult = await createClient().searchOpenIssueByTitle(
        repository.owner,
        repository.repo,
        titleResult.text,
      );
      const duplicate = strictDuplicate(duplicateResult, repository);

      removeExpired();
      if (drafts.size >= maxDrafts) {
        throw new Error("Too many issue report drafts are awaiting review; discard one and retry");
      }

      const draftId = createDraftId();
      if (drafts.has(draftId)) throw new Error("Issue report draft ID collision");
      const draft: StoredDraft = Object.freeze({
        draftId,
        repository: Object.freeze({ ...repository }),
        title: titleResult.text,
        body: bodyResult.text,
        labels: Object.freeze(buildLabels(input.category)),
        maskedCount: titleResult.maskedCount + bodyResult.maskedCount,
        expiresAt: now() + ttlMs,
      });
      drafts.set(draftId, draft);

      return {
        draftId,
        repository: { ...draft.repository },
        title: draft.title,
        body: draft.body,
        labels: [...draft.labels],
        maskedCount: draft.maskedCount,
        duplicate,
      };
    },

    async submit(draftId) {
      if (inFlight.has(draftId))
        throw new Error("Issue report draft submission is already in progress");
      const draft = readDraft(draftId);
      inFlight.add(draftId);
      try {
        const client = createClient();
        const duplicateResult = await client.searchOpenIssueByTitle(
          draft.repository.owner,
          draft.repository.repo,
          draft.title,
        );
        const duplicate = strictDuplicate(duplicateResult, draft.repository);
        if (duplicate.status === "found") {
          drafts.delete(draftId);
          return {
            issueNumber: duplicate.issueNumber,
            issueUrl: canonicalGithubIssueUrl(
              draft.repository.owner,
              draft.repository.repo,
              duplicate.issueNumber,
            ),
            deduped: true,
            maskedCount: draft.maskedCount,
          };
        }

        const created = await client.createIssue({
          owner: draft.repository.owner,
          repo: draft.repository.repo,
          title: draft.title,
          body: draft.body,
          labels: [...draft.labels],
          requireDuplicateCheck: true,
        });
        drafts.delete(draftId);
        return {
          issueNumber: created.number,
          issueUrl: canonicalGithubIssueUrl(
            draft.repository.owner,
            draft.repository.repo,
            created.number,
          ),
          deduped: created.deduped,
          maskedCount: draft.maskedCount,
        };
      } finally {
        inFlight.delete(draftId);
      }
    },

    discard(draftId) {
      if (inFlight.has(draftId))
        throw new Error("Cannot discard an issue report draft during submission");
      drafts.delete(draftId);
    },
  };
}
