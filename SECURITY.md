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

- **Electron CVE backlog**: As of 2026-05-18, GitHub Dependabot reports 29 OPEN Electron alerts (8 HIGH) on the current pin (35.7.5). Upstream patches first land in Electron v38 / v39. Major version bump is on the roadmap but not yet executed because of breaking-change cost. Mitigations in place: renderer `contextIsolation: true`, `sandbox: true` (verify in `app/desktop/electron/main.ts`), and external URL allowlist via `shell.openExternal` wrapper.
- **No code signing / notarization**: Released artifacts are not yet signed. Users must allow execution manually on first launch.
- **No telemetry / Sentry**: User-reported incidents must be reproduced manually; we do not collect remote crash logs.

## Cryptographic / Auth Notes

- Figma PAT never leaves the local machine in the clear; transmitted only over TLS to `https://api.figma.com`.
- No password-based auth, no JWT, no session cookies — FigDiff has no server-side state.
