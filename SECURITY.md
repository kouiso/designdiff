# Security Policy

## Reporting a Vulnerability

Please report security vulnerabilities to **kouiso@ritmo.co.jp** rather than opening a public issue. Include:

- A description of the issue and its potential impact.
- Steps to reproduce, or a minimal proof-of-concept.
- The version (commit SHA or release tag) affected.

You can expect:

- Acknowledgement within **3 business days**.
- An initial triage and severity assessment within **7 business days**.
- A coordinated disclosure timeline negotiated case-by-case (target: 90 days unless agreed otherwise).

## Supported Versions

FigDiff is currently in pre-1.0 development. Security fixes are applied to the latest `develop` branch. There is no LTS branch yet.

## Threat Model

FigDiff runs as an Electron desktop application and a local MCP server. The primary trust boundaries are:

| Boundary | Trust Assumption |
|---|---|
| Figma Personal Access Token (PAT) | Stored encrypted via Electron `safeStorage` (OS Keychain on macOS / DPAPI on Windows / libsecret on Linux). |
| MCP server local filesystem access | Restricted to allowlisted directories via `FIGDIFF_ALLOWED_DIRS`. See `app/mcp-server/src/util/path-guard.ts`. |
| Figma API requests | HTTPS only. Token attached as `X-Figma-Token` header. No third-party endpoints. |
| Image cache (`~/.figdiff/cache/`) | Treated as untrusted on read; decoded with `sharp` (validated image bytes). |
| Project files (`~/.figdiff/projects/<id>/project.json`) | Trusted local user data. Atomic write via tmp+rename. Schema validated by Zod on read. |
| Telemetry (PostHog, opt-in) | Off by default. Whitelist-only event/property schemas in `package/shared/src/telemetry-event.ts` — no Figma file keys, frame names, local paths, screenshot URLs, or tokens are ever sent. See `PRIVACY.md`. |

## Known Limitations

- **Electron CVE backlog**: The current pin is `^39.8.10` (bumped from the 35.7.5 backlog described in earlier revisions of this document). As of 2026-09-02, `gh api repos/kouiso/designdiff/dependabot/alerts` reports **0 open Electron alerts** on this pin. Re-check with the same command before relying on this number — Dependabot alert counts change as new advisories are published. Mitigations in place regardless of alert count: renderer `contextIsolation: true` (see `app/desktop/electron/main.ts`) and external URL allowlist via `shell.openExternal` wrapper. Note: `sandbox: true` is **not** currently set on the `BrowserWindow`'s `webPreferences` — `contextIsolation` + `nodeIntegration: false` are the enforced boundary today.
- **No code signing / notarization**: Released artifacts are not yet signed. Users must allow execution manually on first launch.
- **Telemetry (opt-in, off by default)**: FigDiff can send anonymous, whitelist-only usage events to PostHog if the user explicitly opts in from Settings (desktop) or via `~/.figdiff/telemetry.json` (MCP server). No crash dumps, session replay, or personally identifying data are collected. See `PRIVACY.md` for exactly what is and is not sent, and `SECURITY.md`'s Threat Model table above.

## Cryptographic / Auth Notes

- Figma PAT never leaves the local machine in the clear; transmitted only over TLS to `https://api.figma.com`.
- No password-based auth, no JWT, no session cookies — FigDiff has no server-side state.
