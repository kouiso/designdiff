const PRINTABLE_ASCII_RE = /^[\x21-\x7E]+$/;

type GithubCredentialStatus =
  | { configured: false; valid: false; issue: "missing" }
  | { configured: true; valid: true; issue: null }
  | { configured: true; valid: false; issue: "invalid-chars" };

export function getGithubCredentialStatus(
  env: Record<string, string | undefined> = process.env,
): GithubCredentialStatus {
  const token = env.GITHUB_TOKEN;
  if (!token) {
    return { configured: false, valid: false, issue: "missing" };
  }
  if (!PRINTABLE_ASCII_RE.test(token)) {
    return { configured: true, valid: false, issue: "invalid-chars" };
  }
  return { configured: true, valid: true, issue: null };
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

const HOME_PATH_RE = /\/home\/[^/]+\//g;
const USERS_PATH_RE = /\/Users\/[^/]+\//g;
const WINDOWS_PATH_RE = /\b[A-Za-z]:[/\\]Users[/\\][^/\\]+[/\\]/g;
const TOKEN_RE =
  /\b(ghp_[A-Za-z0-9]+|gho_[A-Za-z0-9]+|ghs_[A-Za-z0-9]+|ghu_[A-Za-z0-9]+|ghr_[A-Za-z0-9]+|figd_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+)\b/g;
const FIGMA_KEY_RE = /figma\.com\/(design|file|proto)\/([A-Za-z0-9]{8,})/g;

interface SanitizeResult {
  text: string;
  maskedCount: number;
}

export function sanitizeForPublicIssue(text: string, includeDesignSource = false): SanitizeResult {
  let maskedCount = 0;
  let result = text;

  result = result.replace(HOME_PATH_RE, () => {
    maskedCount++;
    return "~/";
  });
  result = result.replace(USERS_PATH_RE, () => {
    maskedCount++;
    return "~/";
  });
  result = result.replace(WINDOWS_PATH_RE, () => {
    maskedCount++;
    return "~/";
  });

  // public issue に誤投稿されても被害を抑えるため、既知のトークン形は常に隠す
  result = result.replace(TOKEN_RE, () => {
    maskedCount++;
    return "[REDACTED]";
  });

  if (!includeDesignSource) {
    result = result.replace(/figma\.com\/[^"'\s]+/g, () => {
      maskedCount++;
      return "[FIGMA_URL_REDACTED]";
    });
  } else {
    // include_design_source:true でもファイルキー部分はマスクする
    result = result.replace(FIGMA_KEY_RE, (_match, _type, key: string) => {
      maskedCount++;
      return _match.replace(key, `${"*".repeat(key.length - 4)}${key.slice(-4)}`);
    });
  }

  return { text: result, maskedCount };
}

export interface CreateIssueOptions {
  owner: string;
  repo: string;
  title: string;
  body: string;
  labels?: string[];
}

export interface IssueResult {
  number: number;
  html_url: string;
  deduped: boolean;
}

interface GithubIssueSummary {
  number: number;
  html_url: string;
}

interface GithubIssueSearchItem extends GithubIssueSummary {
  title: string;
}

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

function getGithubIssueSearchItems(value: unknown): GithubIssueSearchItem[] {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return [];
  }
  return value.items.filter(isGithubIssueSearchItem);
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
      return; // 403 or other — no write permission, skip silently
    }
    await fetch(`https://api.github.com/repos/${owner}/${repo}/labels`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ name, color: "ededed" }),
    }).catch(() => undefined); // ignore creation errors (race or no permission)
  }

  async findOpenIssueByTitle(
    owner: string,
    repo: string,
    title: string,
  ): Promise<{ number: number; html_url: string } | null> {
    const q = encodeURIComponent(`repo:${owner}/${repo} type:issue state:open in:title "${title}"`);
    const res = await fetch(`https://api.github.com/search/issues?q=${q}&per_page=5`, {
      headers: this.headers(),
    });
    if (!res.ok) {
      return null;
    }
    const searchResult: unknown = await res.json();
    const items = getGithubIssueSearchItems(searchResult);
    const exact = items.find((issue) => issue.title === title);
    return exact ?? null;
  }

  async createIssue(opts: CreateIssueOptions): Promise<IssueResult> {
    const { owner, repo, title, body, labels = [] } = opts;

    for (const label of labels) {
      await this.ensureLabel(owner, repo, label);
    }

    const existing = await this.findOpenIssueByTitle(owner, repo, title);
    if (existing) {
      return { number: existing.number, html_url: existing.html_url, deduped: true };
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
    return { number: created.number, html_url: created.html_url, deduped: false };
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
  githubServiceInstance = new GithubService(process.env.GITHUB_TOKEN ?? "");
  return githubServiceInstance;
}

export function resolveIssueRepo(): { owner: string; repo: string } {
  const envRepo = process.env.FIGDIFF_ISSUE_REPO ?? "kouiso/designdiff";
  const [owner, repo] = envRepo.split("/");
  if (!owner || !repo) {
    throw new Error(`FIGDIFF_ISSUE_REPO の形式が不正です: ${envRepo} (owner/repo 形式で指定)`);
  }
  return { owner, repo };
}
