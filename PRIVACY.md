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
(`package/shared/src/telemetry-event.ts`) before they leave your machine. An event kind existing
in that whitelist does not by itself mean it is currently sent — the table below lists only the
event kinds an actual code path emits today:

| Event | Properties sent |
|---|---|
| `app_started` | app version, OS platform (`darwin` / `win32` / `linux`) |
| `mcp_tool_invoked` | MCP tool name (e.g. `compare_design`), duration (ms), success boolean |
| `app_error_captured` | which process crashed (`main`/`renderer`), the JS error **class name** only (e.g. `TypeError`), and whether it was fatal |

The whitelist also reserves `consent_changed` and `compare_design_completed` for future use; no
code currently calls them, so nothing under those names leaves your machine yet. If that changes,
this table will be updated in the same PR that adds the emitting code.

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
- Session recordings, screen recordings, or keystroke/click autocapture — none of these features
  are enabled, ever

We also do not let PostHog **enrich or store** your IP address as event data: the `$ip` property
is explicitly set to `null` on every event, and geolocation lookup is disabled. This does not mean
PostHog's servers never observe your IP — any HTTPS request necessarily reveals the source IP to
the receiving network endpoint, the same way it would for any other site your machine connects to.
What these settings prevent is PostHog attaching that address to your event data or deriving a
location from it.

## Where it is sent

Anonymous events are sent to [PostHog](https://posthog.com), a third-party analytics processor.
The destination host is configurable per install:

- **Desktop app**: `POSTHOG_HOST`, baked in at build time (see `app/desktop/electron.vite.config.ts`).
- **MCP server**: `FIGDIFF_POSTHOG_HOST`, read at process start (see `app/mcp-server/src/telemetry.ts`).

Both default to the EU region (`https://eu.i.posthog.com`) and are validated at build/read time
against an allowlist of PostHog's official regional hosts (`https://eu.i.posthog.com`,
`https://us.i.posthog.com`) — an unset or invalid value always falls back to the EU default, it
never silently sends to an arbitrary host. EU-region transmission is guaranteed only when neither
variable is set, or is explicitly set to the EU host; setting either to the US host routes that
process's events to PostHog's US region instead. No other third-party analytics or crash-reporting
service (e.g. Sentry) is currently integrated — see `SECURITY.md` for the reasoning and the
conditions under which that may change.

## Libraries and MCP tool arguments

FigDiff's shared libraries (`@figdiff/shared`, `@figdiff/credential-store`,
`@figdiff/mobile-capture`) never create a PostHog client or send anything over the network — they
are embedded into other people's processes (via the MCP server) and must not phone home on their
own. `@figdiff/shared` does contain the telemetry event **allowlist** (types and Zod schemas that
define what an event is allowed to look like, in `telemetry-event.ts`), but that file has no SDK
dependency and performs no I/O; only the Electron main process and the MCP server actually send
events. The MCP server's tool arguments (which can contain your Figma PAT, file keys, and local
paths) are never read by the telemetry code path — only the tool's name, duration, and
success/failure are recorded.

## Questions

Report privacy concerns the same way as security issues: see `SECURITY.md`.
