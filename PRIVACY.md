# Privacy Policy

FigDiff is a design-comparison tool that renders your unreleased Figma designs, frame names, and
implementation screenshots on screen. This document explains exactly what data leaves your
machine, when, and why.

## Telemetry: off by default, opt-in only

FigDiff does not collect any usage data unless you explicitly turn it on.

- **Desktop app**: Settings → Privacy → "Share anonymous usage data". Default: **off**.
- **MCP server**: consent lives in `~/.figdiff/telemetry.json` (`{ "consent": true }`), default:
  **off**. The environment variable `FIGDIFF_TELEMETRY=0` always forces it off regardless of that
  file. Telemetry is also always skipped when the `CI` environment variable is set.

You can turn telemetry off at any time; no historical data is deleted retroactively by that action,
but no further events are sent.

## What is sent

Telemetry events are validated against a fixed, code-reviewed whitelist
(`package/shared/src/telemetry-event.ts`) before they leave your machine. Only these event
kinds exist, and only these properties are attached to them:

| Event | Properties sent |
|---|---|
| `app_started` | app version, OS platform (`darwin` / `win32` / `linux`) |
| `consent_changed` | the new consent boolean |
| `compare_design_completed` | match percentage, duration (ms), verdict (`pass`/`fail`/`inconclusive`) |
| `mcp_tool_invoked` | MCP tool name (e.g. `compare_design`), duration (ms), success boolean |
| `app_error_captured` | which process crashed (`main`/`renderer`), the JS error **class name** only (e.g. `TypeError`), and whether it was fatal |

An anonymous, randomly generated install ID (not tied to your name, email, or Figma account) is
sent as the distinct ID so repeat events can be grouped. It cannot be reversed to identify you.

## What is never sent

The whitelist above is enforced by a Zod schema at the trust boundary (Electron main process /
MCP server process) — properties outside it are silently dropped, not forwarded. In particular,
FigDiff never sends:

- Figma file keys, frame names, or project names
- Screenshot images or screenshot URLs
- Local file paths (e.g. `file:///Users/you/...`)
- Figma Personal Access Tokens, OAuth tokens, or any other credential
- Exception messages or stack traces (only the error's class name, e.g. `TypeError`, is sent —
  never `error.message` or `error.stack`, which can contain paths or tokens)
- IP address (`$ip` is explicitly set to `null`, and geolocation lookup is disabled)
- Session recordings, screen recordings, or keystroke/click autocapture — none of these features
  are enabled, ever

## Where it is sent

Anonymous events are sent to [PostHog](https://posthog.com) (EU region:
`https://eu.i.posthog.com`), a third-party analytics processor. No other third-party analytics or
crash-reporting service (e.g. Sentry) is currently integrated — see `SECURITY.md` for the
reasoning and the conditions under which that may change.

## Libraries and MCP tool arguments

FigDiff's shared libraries (`@figdiff/shared`, `@figdiff/credential-store`,
`@figdiff/mobile-capture`) never contain telemetry code — they are embedded into other people's
processes (via the MCP server) and must not phone home on their own. The MCP server's tool
arguments (which can contain your Figma PAT, file keys, and local paths) are never read by the
telemetry code path — only the tool's name, duration, and success/failure are recorded.

## Questions

Report privacy concerns the same way as security issues: see `SECURITY.md`.
