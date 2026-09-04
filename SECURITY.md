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

## Known Limitations

- **Electron CVE backlog**: The current pin is `^39.8.10` (`app/desktop/package.json`), bumped from the 35.7.5 backlog described in earlier revisions of this document. Re-check open advisories before relying on that: `gh api "repos/kouiso/designdiff/dependabot/alerts?state=open&package=electron"` — alert counts change as new advisories are published, so this document deliberately records no number. Mitigations in place regardless of alert count: renderer `contextIsolation: true` and `nodeIntegration: false` (set explicitly in `app/desktop/electron/main.ts`), the Chromium renderer sandbox (on by default since Electron 20; not configured explicitly), and the external URL allowlist around `shell.openExternal`.
- **No code signing / notarization**: Released artifacts are not yet signed. Users must allow execution manually on first launch.
- **No telemetry / Sentry**: User-reported incidents must be reproduced manually; we do not collect remote crash logs.

## Cryptographic / Auth Notes

- Figma PAT never leaves the local machine in the clear; transmitted only over TLS to `https://api.figma.com`.
- No password-based auth, no JWT, no session cookies — FigDiff has no server-side state.
