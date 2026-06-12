# FigDiff QA Runbook — 2026-05-18

Author: comprehensive audit 2026-05-18
Purpose: any AI (no human help) can follow this end-to-end and produce PASS/FAIL evidence for the 5 critical paths.
Output location for evidence: `/tmp/figdiff-qa-runs/<ISO-timestamp>/`

Critical paths covered:

1. **build** — all packages compile
2. **unit-tests + coverage gate** — vitest passes, thresholds hold
3. **mcp-server compare_design happy-path** — invoke `compareImages()` on known fixtures, validate output shape
4. **desktop electron-vite dev server boots + serves index** — no port collision, no module resolution errors
5. **release artifact build (Linux fast path)** — `electron-builder --linux` produces an `.AppImage`

Each path has: prereqs, verbatim startup command, expected output, FAIL conditions, evidence path.

---

## Prerequisites

| Requirement | Verification command | Expected |
|---|---|---|
| Node 25.6.1 via mise | `node --version` | `v25.6.1` |
| pnpm 9 via mise | `pnpm --version` | `9.x.x` |
| Repo on `develop` or this audit branch | `git -C $REPO branch --show-current` | starts with `develop` or `docs/v02-roadmap-` |
| `~/.figdiff` writable | `mkdir -p ~/.figdiff && test -w ~/.figdiff && echo OK` | `OK` |
| **No** Figma PAT needed for paths 1–4. Path 5 needs no creds either. | n/a | n/a |

Set the run dir once:

```bash
export REPO="$(git rev-parse --show-toplevel)"
export RUN_DIR="/tmp/figdiff-qa-runs/$(date -u +%Y-%m-%dT%H%M%SZ)"
mkdir -p "$RUN_DIR"
cd "$REPO"
```

---

## Path 1 — build (all packages)

Runs as the first step because everything downstream depends on `@figdiff/shared/dist/index.js`.

```bash
pnpm install --frozen-lockfile > "$RUN_DIR/01-install.log" 2>&1
pnpm build > "$RUN_DIR/01-build.log" 2>&1
echo "exit=$?" >> "$RUN_DIR/01-build.log"
```

Expected (must all be true):

- `01-install.log` ends with `Done in <X>s using pnpm v9.x.x`
- `01-build.log` last lines contain `Tasks:    6 successful, 6 total`
- `01-build.log` ends with `exit=0`
- Artifacts: `package/shared/dist/index.js`, `app/mcp-server/dist/index.js`, `app/desktop/out/main/main.js` all exist

FAIL conditions:

- `pnpm install` exits non-zero → halt; capture full log; do NOT proceed to path 2.
- `pnpm build` exits non-zero → halt; capture full log; first TypeScript error in `tsc` output is the root cause.
- Any `dist/` artifact missing → likely partial build, re-run with `pnpm -r run build --force`.

Evidence saved at: `$RUN_DIR/01-install.log`, `$RUN_DIR/01-build.log`.

---

## Path 2 — unit tests + coverage gate

```bash
pnpm test > "$RUN_DIR/02-test.log" 2>&1
TEST_EXIT=$?
echo "exit=$TEST_EXIT" >> "$RUN_DIR/02-test.log"
pnpm -r --filter "@figdiff/shared" --filter "@figdiff/mcp-server" --filter "@figdiff/desktop" run test:coverage > "$RUN_DIR/02-coverage.log" 2>&1
COV_EXIT=$?
echo "exit=$COV_EXIT" >> "$RUN_DIR/02-coverage.log"
```

Expected:

- `02-test.log`: `Tasks:    6 successful, 6 total` AND `exit=0`
- Test counts (today's baseline; OK if ≥):
  - `@figdiff/shared`: ≥ 99 tests
  - `@figdiff/mcp-server`: ≥ 77 tests
  - `@figdiff/desktop`: ≥ 324 tests
- `02-coverage.log` ends with `exit=0` (no threshold violations)
- Per-package coverage stays at or above (from this audit's set):
  - shared: statements ≥73, branches ≥82, functions ≥83, lines ≥73
  - mcp-server: statements ≥77, branches ≥77, functions ≥75, lines ≥77
  - desktop: statements ≥76, branches ≥81, functions ≥65, lines ≥76

FAIL conditions:

- `02-test.log` shows `Test Files X failed` → identify failing file, read the test name, do NOT skip the test.
- `02-coverage.log` ends with non-zero exit AND contains `ERROR: Coverage for` → identify package + axis; either fix the test gap or, with explicit user approval, lower the threshold (per-package vitest.config.ts) with a comment citing the PR + reason.

Evidence: `$RUN_DIR/02-test.log`, `$RUN_DIR/02-coverage.log`.

---

## Path 3 — mcp-server `compareImages()` happy path

Validates the MCP server's core diff function on a stable fixture pair. No Figma API call — uses bundled test images.

```bash
node -e '
import("file://'"$REPO"'/app/mcp-server/dist/service/image-compare-service.js").then(async ({ compareImages }) => {
  const fs = await import("node:fs/promises");
  const figmaFixture = "/Users/kouiso/ghq/example-org/sample-corporate/test/screenshots/figma/news-sp.png";
  const astroFixture = "/Users/kouiso/ghq/example-org/sample-corporate/test/screenshots/astro/news-sp.png";
  try {
    await fs.access(figmaFixture);
    await fs.access(astroFixture);
  } catch {
    console.log(JSON.stringify({ status: "SKIP", reason: "sample-corp fixture not present on this machine" }));
    process.exit(0);
  }
  const t0 = Date.now();
  const result = await compareImages({
    designBase64: (await fs.readFile(figmaFixture)).toString("base64"),
    screenshotBase64: (await fs.readFile(astroFixture)).toString("base64"),
    threshold: 0.1,
  });
  const { diffImageBase64, diffRegions, ...rest } = result;
  console.log(JSON.stringify({
    status: "OK",
    wall_ms: Date.now() - t0,
    matchRate: rest.matchRate,
    regionCount: (diffRegions || []).length,
    diffImageBase64_chars: (diffImageBase64 || "").length,
  }));
});
' > "$RUN_DIR/03-compare.json" 2>&1
echo "exit=$?" >> "$RUN_DIR/03-compare.json"
```

Expected:

- `03-compare.json` is valid JSON
- One of:
  - `status=OK` with `matchRate ∈ [70, 95]` and `regionCount ∈ [100, 1000]` and `diffImageBase64_chars > 1000` — typical successful diff on news-sp pair
  - `status=SKIP` if fixtures are not on the runner machine
- `wall_ms < 40000` (40 s budget; today's baseline is ~23 s)

FAIL conditions:

- `status=OK` but `matchRate=100` → fixtures are identical (suspect: someone copied figma over astro).
- `wall_ms > 60000` → designdiff#56 perf regression confirmed; quarantine larger fixtures.
- Module import error → path 1 didn't build mcp-server; re-run path 1.
- Process killed by OS (OOM) → designdiff RSS regression; halt.

Evidence: `$RUN_DIR/03-compare.json`.

---

## Path 4 — desktop electron-vite dev server boots

Validates that the renderer dev server starts on `http://localhost:5173` (electron-vite default) and serves the React shell within 30 s. Runs in headless validation mode — does NOT open Electron window (so it works without a display).

```bash
(cd "$REPO/app/desktop" && pnpm dev:web > "$RUN_DIR/04-dev-web.log" 2>&1) &
DEV_PID=$!
# Poll port 5173 for up to 30 s
for i in $(seq 1 30); do
  if curl -fsS http://localhost:5173 > /dev/null 2>&1; then
    echo "READY after ${i}s" > "$RUN_DIR/04-dev-status.txt"
    break
  fi
  sleep 1
done
# Capture body once
curl -fsS http://localhost:5173 > "$RUN_DIR/04-index.html" 2>&1 || echo "NOT_READY" > "$RUN_DIR/04-index.html"
# Always tear down
kill "$DEV_PID" 2>/dev/null
wait "$DEV_PID" 2>/dev/null
```

Expected:

- `04-dev-status.txt` contains `READY after <N>s` with N ≤ 30
- `04-index.html` contains the string `<div id="root">` (React mount point) AND `<title>` (HTML doc structure)
- `04-dev-web.log` does NOT contain `ELIFECYCLE` or `Error:`

FAIL conditions:

- `04-dev-status.txt` not created → server didn't bind to 5173. Check `04-dev-web.log` for port-in-use error.
- `04-index.html` is `NOT_READY` or HTML-shaped but missing `id="root"` → React build entry broken.
- `04-dev-web.log` contains `ELIFECYCLE Command failed` → run `pnpm install` then retry path 1 then this path.

Evidence: `$RUN_DIR/04-dev-status.txt`, `$RUN_DIR/04-index.html`, `$RUN_DIR/04-dev-web.log`.

---

## Path 5 — release artifact build (Linux AppImage, fast)

```bash
(cd "$REPO/app/desktop" && pnpm build && pnpm pack --linux AppImage --x64) > "$RUN_DIR/05-pack-linux.log" 2>&1
echo "exit=$?" >> "$RUN_DIR/05-pack-linux.log"
ls -la "$REPO/app/desktop/dist/"*.AppImage > "$RUN_DIR/05-artifact.txt" 2>&1
```

Expected:

- `05-pack-linux.log` ends with `exit=0`
- `05-artifact.txt` lists at least one `.AppImage` file > 50 MB

FAIL conditions:

- `electron-builder` exit non-zero → read the last 200 lines of `05-pack-linux.log` for the root error.
- AppImage missing or < 50 MB → packaging incomplete; check for native module rebuild errors.
- Run timed out → expected on first run (downloads Electron prebuilts); rerun once.

Evidence: `$RUN_DIR/05-pack-linux.log`, `$RUN_DIR/05-artifact.txt`.

This path is **OPTIONAL** on machines without 5+ GB free disk; can be skipped with `SKIP_PATH_5=1`. If skipped, write `SKIPPED: SKIP_PATH_5=1` to `$RUN_DIR/05-status.txt`.

---

## Completion gate

After all 5 paths complete:

```bash
{
  echo "QA run: $RUN_DIR"
  echo "=== Path 1 build ===";   tail -1 "$RUN_DIR/01-build.log"
  echo "=== Path 2 test ===";    tail -1 "$RUN_DIR/02-test.log"
  echo "=== Path 2 coverage ==="; tail -1 "$RUN_DIR/02-coverage.log"
  echo "=== Path 3 compare ==="; cat "$RUN_DIR/03-compare.json"
  echo "=== Path 4 dev ===";     cat "$RUN_DIR/04-dev-status.txt" 2>/dev/null || echo "missing"
  echo "=== Path 5 pack ===";    tail -1 "$RUN_DIR/05-pack-linux.log" 2>/dev/null || cat "$RUN_DIR/05-status.txt"
} > "$RUN_DIR/SUMMARY.txt"
cat "$RUN_DIR/SUMMARY.txt"
```

ALL-PASS condition: every path's last-line `exit=0` OR `status=OK` (path 3) OR `READY after Xs` (path 4) AND no FAIL condition matched.

ANY-FAIL condition: bring the SUMMARY.txt + the failing log path to the user; do NOT mark "audit shipped" until either fix or explicit user waiver.

---

## Audit verification source tags (per `verification-source-mandate` rule)

When reporting this runbook's results, every claim must carry one of:

- `[実機目視]` — opened the dev URL in a real browser
- `[CI]` — GitHub Actions ran the run and the run number is cited
- `[Static]` — manually read the file content
- `[コード解析]` — read source, did not run
- `[runbook]` — this runbook executed and the evidence path is cited (e.g., `$RUN_DIR/02-test.log:tail`)

Default tag for output of this runbook is `[runbook]` with evidence path.

---

## Maintenance

- When a new critical path is added (e.g., MCP `verify_fix` tool, Chrome extension overlay), add a path 6+ with the same structure.
- When per-package coverage baseline changes substantially, update the "stays at or above" numbers in Path 2.
- The Path 3 fixture path is sample-corp-specific. When this repo migrates fixtures into its own `test/fixtures/`, switch the path and remove the SKIP branch.
