import { execFileSync } from "node:child_process";

const PRINTABLE_ASCII_RE = /^[\x21-\x7E]+$/;
const GITHUB_OWNER_RE = /^(?!-)[a-zA-Z0-9-]{1,39}(?<!-)$/;
const GITHUB_REPO_RE = /^(?!\.{1,2}$)[a-zA-Z0-9._-]{1,100}$/;

export type GithubCredentialStatus =
  | { configured: false; valid: false; issue: "missing" }
  | {
      configured: true;
      valid: true;
      issue: null;
      token: string;
      source: "env" | "gh";
    }
  | { configured: true; valid: false; issue: "invalid-chars" };

function readGhCliToken(): string | null {
  try {
    const token = execFileSync("gh", ["auth", "token"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

export function getGithubCredentialStatus(
  env: Record<string, string | undefined> = process.env,
  ghTokenResolver: () => string | null = readGhCliToken,
): GithubCredentialStatus {
  const envToken = env.GITHUB_TOKEN ?? env.GH_TOKEN;
  const token = envToken ?? ghTokenResolver();
  if (!token) {
    return { configured: false, valid: false, issue: "missing" };
  }
  if (!PRINTABLE_ASCII_RE.test(token)) {
    return { configured: true, valid: false, issue: "invalid-chars" };
  }
  return {
    configured: true,
    valid: true,
    issue: null,
    token,
    source: envToken === token ? "env" : "gh",
  };
}

export function formatGithubCredentialError(status: GithubCredentialStatus): string {
  if (status.issue === "missing") {
    return "GITHUB_TOKEN が未設定です。`GITHUB_TOKEN=$(gh auth token)` で設定してください。";
  }
  if (status.issue === "invalid-chars") {
    return "GITHUB_TOKEN に不正な文字が含まれています。";
  }
  return "";
}

export interface CreateIssueOptions {
  owner: string;
  repo: string;
  title: string;
  body: string;
  labels?: string[];
  /** 重複照合ができない場合、Issueを作らずエラーにする。 */
  requireDuplicateCheck?: boolean;
}

export interface IssueResult {
  number: number;
  html_url: string;
  deduped: boolean;
}

export interface GithubIssueSummary {
  number: number;
  html_url: string;
}

interface GithubIssueSearchItem extends GithubIssueSummary {
  title: string;
}

export type OpenIssueSearchResult =
  | { status: "found"; issue: GithubIssueSummary }
  | { status: "none" }
  | {
      status: "unavailable";
      reason: "http" | "invalid-response" | "request-error";
      statusCode?: number;
      message: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isGithubIssueSearchItem(value: unknown): value is GithubIssueSearchItem {
  return (
    isRecord(value) &&
    typeof value.number === "number" &&
    typeof value.html_url === "string" &&
    typeof value.title === "string"
  );
}

function getGithubIssueSearchItems(value: unknown): GithubIssueSearchItem[] | null {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return null;
  }
  if (!value.items.every(isGithubIssueSearchItem)) {
    return null;
  }
  return value.items;
}

function isGithubIssueSummary(value: unknown): value is GithubIssueSummary {
  return isRecord(value) && typeof value.number === "number" && typeof value.html_url === "string";
}

export class GithubService {
  constructor(private readonly token: string) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  async ensureLabel(owner: string, repo: string, name: string): Promise<void> {
    const checkRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/labels/${encodeURIComponent(name)}`,
      { headers: this.headers() },
    );
    if (checkRes.ok) {
      return;
    }
    if (checkRes.status !== 404) {
      return;
    }
    await fetch(`https://api.github.com/repos/${owner}/${repo}/labels`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ name, color: "ededed" }),
    }).catch(() => undefined);
  }

  async searchOpenIssueByTitle(
    owner: string,
    repo: string,
    title: string,
  ): Promise<OpenIssueSearchResult> {
    const q = encodeURIComponent(`repo:${owner}/${repo} type:issue state:open in:title "${title}"`);
    try {
      const res = await fetch(`https://api.github.com/search/issues?q=${q}&per_page=5`, {
        headers: this.headers(),
      });
      if (!res.ok) {
        return {
          status: "unavailable",
          reason: "http",
          statusCode: res.status,
          message: `GitHub issue search failed with status ${res.status}`,
        };
      }
      const searchResult: unknown = await res.json();
      const items = getGithubIssueSearchItems(searchResult);
      if (items === null) {
        return {
          status: "unavailable",
          reason: "invalid-response",
          message: "GitHub issue search response is invalid",
        };
      }
      const exact = items.find((issue) => issue.title === title);
      return exact === undefined
        ? { status: "none" }
        : { status: "found", issue: { number: exact.number, html_url: exact.html_url } };
    } catch (error: unknown) {
      return {
        status: "unavailable",
        reason: "request-error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** 旧呼び出し元向け。検索不能と重複なしを区別する場合は searchOpenIssueByTitle を使う。 */
  async findOpenIssueByTitle(
    owner: string,
    repo: string,
    title: string,
  ): Promise<GithubIssueSummary | null> {
    const result = await this.searchOpenIssueByTitle(owner, repo, title);
    if (result.status === "unavailable" && result.reason === "request-error") {
      throw new Error(result.message);
    }
    return result.status === "found" ? result.issue : null;
  }

  async createIssue(opts: CreateIssueOptions): Promise<IssueResult> {
    const { owner, repo, title, body, labels = [], requireDuplicateCheck = false } = opts;

    // 厳格モードでは重複照合が済むまでラベル作成も行わない。照合不能で止める契約なのに、
    // 先に外部状態を変えると「Issueは作らなかったがラベルは作った」半端な失敗になるため。
    const searchResult = requireDuplicateCheck
      ? await this.searchOpenIssueByTitle(owner, repo, title)
      : undefined;
    if (searchResult?.status === "unavailable") {
      throw new Error(`GitHub issue の重複を確認できませんでした: ${searchResult.message}`);
    }
    if (searchResult?.status === "found") {
      return {
        number: searchResult.issue.number,
        html_url: searchResult.issue.html_url,
        deduped: true,
      };
    }

    for (const label of labels) {
      await this.ensureLabel(owner, repo, label);
    }

    const compatibleSearchResult =
      searchResult ?? (await this.searchOpenIssueByTitle(owner, repo, title));
    if (compatibleSearchResult.status === "found") {
      return {
        number: compatibleSearchResult.issue.number,
        html_url: compatibleSearchResult.issue.html_url,
        deduped: true,
      };
    }
    if (
      compatibleSearchResult.status === "unavailable" &&
      compatibleSearchResult.reason === "request-error"
    ) {
      throw new Error(compatibleSearchResult.message);
    }

    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ title, body, labels }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`GitHub API error ${res.status}: ${err}`);
    }

    const created: unknown = await res.json();
    if (!isGithubIssueSummary(created)) {
      throw new Error("GitHub API response is missing issue number or URL");
    }
    return {
      number: created.number,
      html_url: created.html_url,
      deduped: false,
    };
  }
}

let githubServiceInstance: GithubService | null = null;

export function createGithubService(): GithubService {
  if (githubServiceInstance) {
    return githubServiceInstance;
  }
  const status = getGithubCredentialStatus();
  if (!status.valid) {
    throw new Error(formatGithubCredentialError(status));
  }
  githubServiceInstance = new GithubService(status.token);
  return githubServiceInstance;
}

export function resolveIssueRepo(): { owner: string; repo: string } {
  const envRepo = process.env.FIGDIFF_ISSUE_REPO ?? "kouiso/designdiff";
  const segments = envRepo.split("/");
  if (
    segments.length !== 2 ||
    !GITHUB_OWNER_RE.test(segments[0] ?? "") ||
    !GITHUB_REPO_RE.test(segments[1] ?? "")
  ) {
    // 設定値がtoken等を誤って含んでいても、公開Issue起票前のエラーへ再掲しない。
    throw new Error(
      "FIGDIFF_ISSUE_REPO の形式が不正です。安全な GitHub owner/repo 形式で指定してください。",
    );
  }
  const owner = segments[0];
  const repo = segments[1];
  if (owner === undefined || repo === undefined) {
    throw new Error("FIGDIFF_ISSUE_REPO の形式が不正です。");
  }
  return { owner, repo };
}
