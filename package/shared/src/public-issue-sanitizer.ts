const HOME_PATH_RE = /\/home\/[^/]+\//gi;
const USERS_PATH_RE = /\/Users\/[^/]+\//gi;
const WINDOWS_PATH_RE = /\b[A-Za-z]:[/\\]Users[/\\][^/\\]+[/\\]/gi;
const WSL_HOME_PATH_RE = /\\\\(?:wsl\.localhost|wsl\$)\\[^\\]+\\home\\[^\\]+\\/gi;
const MOUNTED_WINDOWS_PATH_RE = /\/mnt\/[a-z]\/Users\/[^/]+\//gi;
const TOKEN_RE =
  /\b(ghp_[A-Za-z0-9]+|gho_[A-Za-z0-9]+|ghs_[A-Za-z0-9]+|ghu_[A-Za-z0-9]+|ghr_[A-Za-z0-9]+|figd_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g;
const FIGMA_KEY_RE = /figma\.com\/(design|file|proto)\/([A-Za-z0-9]{8,})/gi;

export interface SanitizeResult {
  text: string;
  maskedCount: number;
}

export function sanitizeForPublicIssue(text: string, includeDesignSource = false): SanitizeResult {
  let maskedCount = 0;
  let result = text;

  const maskHomePath = () => {
    maskedCount++;
    return "~/";
  };

  // WSLの長い接頭辞を先に処理し、途中のUsersだけを置換してパスを壊さない。
  for (const pattern of [WSL_HOME_PATH_RE, MOUNTED_WINDOWS_PATH_RE]) {
    result = result.replace(pattern, maskHomePath);
  }

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
    result = result.replace(/figma\.com\/[^"'\s]+/gi, () => {
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
