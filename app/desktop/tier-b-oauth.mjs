/**
 * Tier B real round-trip OAuth verification.
 * Opens authUrl via macOS `open` command (default browser),
 * waits for the loopback callback, then exchanges and verifies.
 *
 * Security: token body never printed; only length + first 2 chars logged.
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

// ── Load .env.local ──────────────────────────────────────────────────────────
const envPath = resolve(import.meta.dirname, ".env.local");
const envLines = readFileSync(envPath, "utf8").split("\n");
for (const line of envLines) {
  const m = line.match(/^([^#=]+)=(.+)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const CLIENT_ID = process.env.FIGMA_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.FIGMA_OAUTH_CLIENT_SECRET;
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("FIGMA_OAUTH_CLIENT_ID / FIGMA_OAUTH_CLIENT_SECRET not set in .env.local");
  process.exit(1);
}
console.info(`[tier-b] client_id length=${CLIENT_ID.length} prefix=${CLIENT_ID.slice(0, 4)}…`);

// ── PKCE ─────────────────────────────────────────────────────────────────────
const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const state = randomBytes(32).toString("hex");

// ── Build authUrl ─────────────────────────────────────────────────────────────
const FIXED_PORT = 51073;
const REDIRECT_URI = `http://localhost:${FIXED_PORT}/callback`;
const params = new URLSearchParams({
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT_URI,
  scope: "file_content:read current_user:read",
  state,
  response_type: "code",
  code_challenge: challenge,
  code_challenge_method: "S256",
});
const authUrl = `https://www.figma.com/oauth?${params.toString()}`;

// ── Start loopback server BEFORE opening browser ──────────────────────────────
const SUCCESS_HTML =
  '<!DOCTYPE html><html><head><meta charset="utf-8"></head>' +
  '<body style="font-family:sans-serif;padding:2rem"><h2>✅ ログイン完了</h2>' +
  "<p>このタブを閉じてください。</p></body></html>";

const code = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    server.close();
    reject(new Error("Timeout: no callback received within 600s"));
  }, 600_000);

  const server = createServer((req, res) => {
    console.info(`[tier-b] incoming: ${req.method} ${req.url} from ${req.socket.remoteAddress}`);

    // Handle PNA preflight (Chrome requires Access-Control-Allow-Private-Network for public→localhost redirects)
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "https://www.figma.com",
        "Access-Control-Allow-Private-Network": "true",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "content-type",
        "Access-Control-Max-Age": "86400",
      });
      res.end();
      return;
    }

    let url;
    try {
      url = new URL(req.url ?? "/", `http://localhost:${FIXED_PORT}`);
    } catch {
      res.writeHead(400).end();
      return;
    }

    if (url.pathname !== "/callback") {
      res.writeHead(404).end();
      return;
    }

    const receivedState = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    if (error) {
      res
        .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
        .end(`<html><body><h2>エラー: ${error}</h2></body></html>`);
      clearTimeout(timeout);
      server.close();
      reject(new Error(`Figma OAuth error: ${error}`));
      return;
    }

    if (receivedState !== state) {
      res.writeHead(400).end("CSRF state mismatch");
      clearTimeout(timeout);
      server.close();
      reject(new Error("CSRF state mismatch"));
      return;
    }

    if (!code) {
      res.writeHead(400).end("Missing code");
      clearTimeout(timeout);
      server.close();
      reject(new Error("Missing authorization code"));
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(SUCCESS_HTML);
    clearTimeout(timeout);
    server.close();
    resolve(code);
  });

  server.on("error", (e) => {
    reject(new Error(`Server error: ${e.message}`));
  });

  // Dual-stack: accept both IPv4 (127.0.0.1) and IPv6 (::1) so Chrome's
  // redirect to http://localhost works regardless of which address it resolves first.
  server.listen({ port: FIXED_PORT, host: "::", ipv6Only: false }, () => {
    console.info(`[tier-b] loopback server listening on port ${FIXED_PORT}`);
    execSync(`open -a Safari '${authUrl}'`);
    console.info(`[tier-b] Safari opened.`);
    console.info(`[tier-b] Auth URL (open manually if needed): ${authUrl}`);
    console.info(`[tier-b] → If not logged into Figma in Safari, log in first, then Allow`);
    console.info(`[tier-b] Waiting for callback... (600s timeout)`);
  });
});

console.info(`[tier-b] ✓ callback received. code length=${code.length}`);

// ── Token exchange ────────────────────────────────────────────────────────────
const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
const tokenBody = new URLSearchParams({
  redirect_uri: REDIRECT_URI,
  code,
  grant_type: "authorization_code",
  code_verifier: verifier,
});

console.info("[tier-b] exchanging code for token...");
const tokenResp = await fetch("https://api.figma.com/v1/oauth/token", {
  method: "POST",
  headers: {
    Authorization: `Basic ${basicAuth}`,
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: tokenBody.toString(),
});

if (!tokenResp.ok) {
  const txt = await tokenResp.text();
  console.error(`[tier-b] token exchange FAILED (${tokenResp.status}): ${txt}`);
  process.exit(1);
}

const tokenJson = await tokenResp.json();
const accessToken = tokenJson.access_token;
console.info(
  `[tier-b] token exchange SUCCESS. access_token: len=${accessToken?.length} prefix=${accessToken?.slice(0, 2)}…`,
);
console.info(`[tier-b] expires_in=${tokenJson.expires_in}s`);

// ── Verify token with /v1/me ──────────────────────────────────────────────────
console.info("[tier-b] calling GET /v1/me to verify token...");
const meResp = await fetch("https://api.figma.com/v1/me", {
  headers: { Authorization: `Bearer ${accessToken}` },
});

if (!meResp.ok) {
  console.error(`[tier-b] /v1/me FAILED (${meResp.status}): ${await meResp.text()}`);
  process.exit(1);
}

const me = await meResp.json();
console.info(`\n[tier-b] ✓ REAL ROUND-TRIP SUCCESS`);
console.info(`[tier-b] user.handle = ${me.handle}`);
console.info(`[tier-b] user.email  = ${me.email}`);
