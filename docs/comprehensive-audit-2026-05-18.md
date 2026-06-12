# Comprehensive Self-Audit — 2026-05-18

Owner: Isogai Kosuke
Auditor: Claude (Opus 4.7)
Adversarial reviewer: OpenAI Codex CLI (`codex exec` background run, 95.5K tokens)
Worktree: `docs/comprehensive-audit-2026-05-18` off `origin/develop` at `927ea7b` (later sync to tip)
Anti-laziness rule: applied throughout. SELF-KICK events recorded inline.

This audit is **honest** rather than charitable. Where the adversarial codex review forced a score down, the doc records the original score, the codex pushback, and the revised score.

---

## Phase 1 — Past-Session Inventory

Only one jsonl source exists on this machine for this project:
`/Users/kouiso/.claude/projects/-Users-kouiso-ghq-kouiso-designdiff/a1b2204c-3fe2-40fb-a8b2-a76f1682f02c.jsonl` (4.67 MB).

The original prompt asked for WSL (`-home-kouiso-*`) and macmini cross-machine ingest. Neither path exists on this Mac and `macmini-lan` DNS does not resolve from this session. **GAP DISCLOSED**: 1 jsonl read, not N.

Cross-references: `gh pr list --state all` (50 entries), `gh issue list --state all`, `codex cloud list`, `git log --all --since='30 days ago'`, `git branch -a`, `gh api repos/kouiso/designdiff/dependabot/alerts`.

### 1.1 DONE (with verification)

| ID | Subject | Evidence |
|---|---|---|
| PR #49 | UX/UI audit doc (48 findings) | merged `c485886`; doc at `doc/ux-audit-2026-05-16.md` |
| PR #50 | Eval vs sample-corporate (capability + benchmark) | merged `420eec1`; doc + `.results.json` |
| PR #51 | Grid clusterer for full-page screenshots | merged `927ea7b`; `package/shared/src/diff-cluster.ts` + 20 tests |
| PR #52 | Test strategy + functional QA checklists | merged `75b6665`; `doc/test-strategy.md` + `scripts/eval/figdiff-cluster-bench.mjs` |
| PR #53 | Per-package coverage thresholds + CI gate | merged today; per-package `vitest.config.ts` + `.github/workflows/ci.yml` matrix |
| PR #47, #48 | Desktop window + MCP entry recovery, tab project state sync | merged; fix branch still present (cleanup pending) |

### 1.2 IN-PROGRESS

| Item | State |
|---|---|
| `fix/startup-and-mcp-entrypoint-2026-05-04` local branch | Has 5 WIP stash commits on top of merged work. Cleanup decision below. |
| 5 `wip/stash-designdiff-{0..4}-20260516` remote branches | Pre-shutdown state preservers. Will rot. Cleanup decision below. |

### 1.3 DROPPED / NEVER-STARTED

| Item | Why it never moved | Action |
|---|---|---|
| Issue #1: Figma plugin dedup refactor (opened 2026-03-20) | Out of session priority lanes | Keep open, link from audit doc |
| `perFile: true` coverage thresholds | Deferred in PR #53 reply to gemini | Track as follow-up |
| Test/coverage matrix consolidation | Deferred in PR #53 reply to gemini | Track as follow-up |
| Semantic Figma node diff | Acknowledged in eval doc (PR #50) — pixel diff weakness identified, semantic-aware diff is the "go differentiate" pivot | High-leverage follow-up |
| Named `ignore_regions` YAML | Same eval doc | Follow-up |
| 5 dependabot PR branches on remote | Auto-superseded by closed PR #43 + others | Audit cleanup |
| 17 stale local branches | Solo dev natural sediment | Audit cleanup |
| 45 OPEN dependabot security alerts | Never triaged | **This audit triages all 45 — see §3.security** |

---

## Phase 2 — 14-Axis Self-Audit (with codex pushback)

Format per axis: `original score → revised score (codex reasoning if revised)`. Evidence in fenced lines. Where revision needed in-session work, it was done.

| # | Axis | Original | Revised | Evidence |
|---|---|---|---|---|
| 1 | feature-completeness | 60 | **50** | Codex: "missing semantic node/layout diff drags this nearer 45-50 if product claim is Figma-vs-implementation design review". Eval PR #50 already documents pixel-only weakness on Astro sites. |
| 2 | test-coverage | 85 | **65** | Codex: "indefensible; functions: 65 threshold + 68.82% function coverage on desktop, E2E tests are web/Vite smoke not native Electron". AGREE. Only 4 desktop e2e in `app/desktop/e2e/`, none assert IPC/canvas. |
| 3 | security | 40 | **25** | Codex: "Electron 35 stale + overlay.ts:129 strips CSP/X-Frame-Options". **§3.security investigates**. This audit fixed 10/45 dependabot via pnpm.overrides; 29 Electron + 6 misc remain. |
| 4 | docs | 85 | **60** | Codex: "missing SECURITY.md, CONTRIBUTING.md, CHANGELOG (present but stale), privacy notice, rollback/runbook, incident response". This audit adds `SECURITY.md` (covers ~+15 pts). |
| 5 | dep-health | 60 | **55** | Codex: "no enforced upgrade SLA". This audit bumped 11 minor deps + applied 5 overrides. Major bumps (Electron 35→39, vitest 3→4, etc.) remain. |
| 6 | performance | 70 | **45** | Codex: "Playwright perf samples only the web build and ci.yml does not run Playwright; no enforced Electron performance budget". CONFIRMED — `.github/workflows/ci.yml` has no Playwright job, `playwright.config.ts` exists but is unused in CI. |
| 7 | a11y | 50 | **35** | Codex: "no axe gate; written audit + zero enforcement is not an a11y program". AGREE. UX audit PR #49 = report, not gate. |
| 8 | edge-cases | 65 | **55** | Codex did not push back; my own re-read: height-only resize branch (`image-compare.ts:58`) is untested in `image-compare.test.ts` (tests cover width-mismatch + both-match but not height-mismatch). |
| 9 | regression-risk | 75 | **55** | Codex: "unit coverage gates do not cover native Electron behavior, release packaging, overlay injection, or visual canvas regressions". AGREE. |
| 10 | deploy-readiness | 80 | **40** | Codex: "fantasy; signing/notarization/update verification absent; TODO.md still lists signing and updater work". Verified: `electron-builder.json5` has targets but no `mac.identity`, no `mac.notarize`, no `win.certificateFile`, no `publish` block. |
| 11 | observability | 30 | **20** | Codex: "even 30 may be generous". AGREE. `find app/ package/ -name 'logger*'` returns nothing. Only `console.warn/error`. |
| 12 | UX-friction | 65 | **55** | Adversarial review did not lower; self-reread: 48 UX findings unaddressed by code, only documented. |
| 13 | i18n | 70 | **75** | Codex actually IMPROVED my score: language switcher exists at `app/desktop/src/component/setting/setting-dialog.tsx:148`, I missed it. Verified above 75% confidence — switcher works but persistence across restarts NOT verified end-to-end (no e2e for it). |
| 14 | data-integrity | 75 | **70** | This audit added `writeProjectFileAtomic()` in `app/desktop/electron/ipc/project.ts` (tmp+rename pattern). Codex's "still uses direct writeFileSync" was based on pre-fix snapshot. Still gap: no schema migration, no backup. |

### 2.X Additional axes (codex MISSED — adopted)

| # | Axis | Score | Evidence |
|---|---|---|---|
| 15 | supply-chain / release-integrity | **15** | No SBOM, no provenance attestation, no Sigstore, release artifacts unsigned. Codex: "track as own axis". |
| 16 | upgradeability / maintenance-latency | **40** | Electron 35 (released Oct 2024) still pinned in May 2026 = 19-month lag. No Renovate. |
| 17 | operational-recoverability | **25** | No backup of project files, no rollback path documented, no token reset doc. |

### 2.0 Audit Score Summary

Original 14-axis average: **65.4 / 100**
Revised 14-axis average: **47.4 / 100**
Including 3 new codex-suggested axes: **44.5 / 100** across 17 axes.

This is a **D+ grade**. The original 65 was naïvely charitable.

---

## Phase 3 — Pre-mortem (≥10 scenarios; ≥3 HIGH × HIGH required)

Each scenario: probability ∈ {LOW, MED, HIGH} × impact ∈ {LOW, MED, HIGH, CRITICAL} × current mitigation strength ∈ {NONE, WEAK, MED, STRONG}.

| # | Scenario | P | I | Mit | Net Risk |
|---|---|---|---|---|---|
| **1** | **Electron 35 vulnerability + overlay CSP stripping → renderer/browser-process exposure** | MED | CRITICAL | WEAK (sandbox+contextIsolation only) | **HIGH × HIGH** |
| **2** | **Project file corruption on partial write** (mitigated by this audit's `writeProjectFileAtomic`) | LOW (post-fix) | HIGH | STRONG (atomic write applied) | LOW × HIGH → LOW net |
| **3** | **Pixel diff weakness drives users away** (already documented in `doc/evaluation-2026-05-16-vs-sample-corporate.md`) | HIGH | HIGH | WEAK (grid clusterer is foundation only; no semantic diff yet) | **HIGH × HIGH** |
| 4 | Figma API breakage (token model / image export change) | MED | HIGH | NONE | MED × HIGH |
| 5 | Silent diff failures from broad `catch(...)` swallowing | MED | MED | WEAK (PR #33 fixed one path; others untouched) | MED × MED |
| 6 | MCP session RSS leak crashes 4GB systems | LOW (unproven) | MED | NONE | LOW × MED |
| **7** | **Release artifact rejected on first launch (no signing/notarization)** | HIGH | HIGH | NONE (verified: no `mac.identity`, no `win.certificateFile`) | **HIGH × HIGH** |
| 8 | shadcn/ui upgrade breaks compare canvas (no snapshot test) | MED | MED | NONE | MED × MED |
| 9 | Figma token exfil via XSS on MCP-returned text | LOW (React escaping default) | HIGH | MED (CSP + context isolation outside overlay) | LOW × HIGH |
| 10 | Bus factor = 1 (solo dev) | HIGH (forever, until +1 person) | HIGH (months-long onboarding) | NONE (CLAUDE.md is AI-focused, no human onboarding) | **HIGH × HIGH** but slow-burn |
| 11 | 20+ outdated deps rot into upgrade-blocking conflict | HIGH | LOW-MED | WEAK (this audit bumped 11; no Renovate) | HIGH × MED |
| 12 | wip/stash-* branches stay forever as dead remote pollution | CERTAIN | LOW | NONE | CERTAIN × LOW |
| 13 | No rollback runbook → outage MTTR doubles | LOW | HIGH (when outage hits) | NONE | LOW × HIGH |
| 14 | Token storage privacy posture undocumented → user trust erosion at commercialization | MED | MED | WEAK (this audit's SECURITY.md is a start, no PRIVACY.md yet) | MED × MED |
| 15 | Pixel diff produces false-positives on subpixel rendering / antialiasing differences | HIGH | MED | WEAK (threshold setting exists; no per-region tolerance) | HIGH × MED |

**HIGH × HIGH count: 4 (rows 1, 3, 7, 10)** — satisfies the ≥3 requirement.

---

## Phase 4 — Adversarial Codex Review (executed)

Codex `gpt-5-codex` ran 95.5K tokens via local CLI (Cloud env not configured for designdiff). Log: `/tmp/audit-2026-05-18/codex-output3.log`. Submission prompt: `/tmp/audit-2026-05-18/codex-prompt-v3.txt`.

### 4.1 Findings accepted (with evidence)

- **CRITICAL**: `app/desktop/electron/ipc/overlay.ts:129` strips CSP / X-Frame-Options / CSP-Report-Only headers from the overlay session. The code has an inline rationale (sandbox+contextIsolation+no nodeIntegration as mitigations), so this is a known tradeoff, not a stealth backdoor — but it is a **defense-in-depth weakness** the original audit missed entirely.
- All 11 Q1 score-too-generous critiques: applied to revised scores above.
- All 6 root-cause critiques in Q3: integrated as "additional axes" + recorded in §6 below.
- 3 missed axes (supply-chain, upgradeability, operational-recoverability): adopted.
- 4 missed "unverified end-to-end" claims: recorded in §7 below.
- 3 missed HIGH×HIGH pre-mortem scenarios (Electron+overlay, release artifact trust, privacy posture): folded into the pre-mortem table.

### 4.2 Findings rejected (with reasoning)

- Codex: "data-integrity 75 too generous because project.ts:96 still uses direct writeFileSync".
  **REJECT** — Codex reviewed the pre-fix prompt. The fix is in this PR. Score updated to 70 (still not 100 because no migration / no backup), but the writeFileSync claim is stale.
- Codex framed the overlay CSP-stripping as "exploitable" without proof-of-concept.
  **PARTIAL REJECT** — defense-in-depth concern is legitimate (accepted), but "exploitable" overstates without a demonstrated injection path through the sandboxed render+contextIsolated process. Tracked as risk #1 in pre-mortem, not as a known live exploit.
- Codex did not engage with the i18n switcher correctly until cross-checked — initial dismissal was premature.

### 4.3 Codex's TOP_3_ACTIONS (adopted into roadmap)

1. **Upgrade Electron to a supported patched line** (35 → 39 LTS) and harden / remove the overlay CSP-stripping path (or scope it to a strict allowlist of trusted preview origins).
2. **Add native E2E gates** for project save crash-recovery, token storage, overlay compare, canvas screenshot regression. Wire Playwright into CI (currently `playwright.config.ts` exists but no workflow runs it).
3. **Ship release-integrity basics**: signing/notarization verification, SECURITY/privacy docs (SECURITY.md added in this PR; PRIVACY.md follow-up), rollback runbook, dependency CVE SLA.

---

## Phase 5 — Confirmed-DONE / Newly-Discovered / Codex Findings / Risks / Scores

### 5.a Confirmed DONE in this audit (with verification evidence)

| Action | Verification |
|---|---|
| `pnpm.overrides` for fast-uri≥3.1.2, hono≥4.12.18, ip-address≥10.1.1, postcss≥8.5.10, @xmldom/xmldom≥0.8.13 | `pnpm list -r --depth Infinity \| grep -E 'fast-uri \|hono \|ip-address \|@xmldom'` shows new versions (3.1.2 / 4.12.19 / 10.2.0 / 0.9.10). |
| Minor dep bumps (zod 4.4.2→4.4.3, biome 2.4.14→2.4.15, turbo 2.9.8→2.9.14, typescript-eslint 8.59.1→8.59.3, react/react-dom 19.2.5→19.2.6, zustand 5.0.12→5.0.13, @playwright/test 1.59→1.60) | `pnpm outdated -r` rerun: remaining only major-version pending. |
| Atomic write for project files (`app/desktop/electron/ipc/project.ts`) | typecheck pass; pattern is `writeFileSync(tmp); renameSync(tmp, real)` — POSIX rename within same dir is atomic on macOS/Linux. |
| `SECURITY.md` added at repo root | File present; documents reporting channel, supported versions, threat model, known Electron CVE backlog. |
| Adversarial codex review executed and integrated | 95.5K tokens consumed; specific disagreements recorded above. |

### 5.b Newly-discovered missed work (with executed remediation OR follow-up link)

| Discovery | Status |
|---|---|
| 10 of 45 dependabot alerts directly fixable via `pnpm.overrides` | **FIXED in this PR** |
| `app/desktop/electron/ipc/overlay.ts:129` strips CSP/X-Frame-Options (defense-in-depth gap) | Documented in `SECURITY.md` § Known Limitations. **Follow-up**: scope to allowlist OR remove CSP-stripping after Electron upgrade (issue to file). |
| `electron-builder.json5` has no signing/notarization | Follow-up — needs Apple Developer cert + Windows certificate. Not actionable in this audit session. |
| No CI Playwright job despite `playwright.config.ts` existing | Follow-up issue: wire Playwright into `.github/workflows/ci.yml`. |
| Height-only resize branch in `app/desktop/src/service/image-compare.ts:58` lacks test | Follow-up: add `image-compare.test.ts` case `width-match height-mismatch`. |
| Project file format has no `version` field → migration story missing | Follow-up: add `schemaVersion: 1` to ProjectSchema. |
| No CONTRIBUTING.md or PRIVACY.md | Follow-up. |
| 5 `wip/stash-designdiff-*` remote branches + 5 stale dependabot branches + 17 local branches | Cleanup proposed in §5.f below — requires kouiso authorization (destructive on remote). |

### 5.c Codex adversarial findings + my response

See §4.1 (accepted) and §4.2 (rejected) above for line-by-line.

### 5.d Residual risks (probability × impact × mitigation)

See §3 pre-mortem table. Four HIGH×HIGH risks remain:

1. Electron 35 + overlay CSP gap (needs Electron upgrade)
2. Pixel diff weakness vs product promise (needs semantic Figma node diff)
3. Release artifact trust (needs signing/notarization)
4. Bus factor = 1 (needs CONTRIBUTING.md + onboarding doc)

### 5.e 17-axis score per evidence

See §2 table. Composite revised: **44.5 / 100**.

### 5.f Cleanup proposal requiring kouiso authorization (NOT executed)

The following actions would touch the remote and are paused for explicit OK:

```bash
# Delete 5 stale dependabot branches (PRs already merged / superseded)
git push origin --delete \
  dependabot/github_actions/all-actions-f13e834c3b \
  dependabot/npm_and_yarn/globals-17.4.0 \
  dependabot/npm_and_yarn/minor-patch-4dedb7b010 \
  dependabot/npm_and_yarn/minor-patch-ae4a5e5b6b \
  dependabot/npm_and_yarn/minor-patch-b8aefc2434

# Delete 5 wip/stash-* remote branches (pre-shutdown snapshots, never integrated)
git push origin --delete \
  wip/stash-designdiff-0-20260516 \
  wip/stash-designdiff-1-20260516 \
  wip/stash-designdiff-2-20260516 \
  wip/stash-designdiff-3-20260516 \
  wip/stash-designdiff-4-20260516

# Clean 17 local branches that are merged into develop
git branch --merged develop | grep -vE '^\*|develop|main' | xargs git branch -d
```

### 5.g Follow-up issues to file

Filed as part of this PR's body (so the GH issue tracker captures them):

1. Wire Playwright into CI workflow.
2. Plan Electron 35 → 39 LTS upgrade (breaking-change inventory, IPC API surface review, native module rebuild).
3. Add code signing + notarization to release CI (macOS, Windows).
4. Add PRIVACY.md + token-storage handling documentation.
5. Add CONTRIBUTING.md (human onboarding, not AI-focused).
6. Add schemaVersion + migration registry to project file format.
7. Add height-only resize test case.
8. Add axe-core a11y job to CI for desktop frontend.
9. Replace `console.warn/error` with structured logger; consider error-reporting service.
10. Scope or remove overlay CSP-stripping path after Electron upgrade.
11. Bump major versions: Electron 35→39, vitest/coverage-v8 3→4, @vitejs/plugin-react 4→6, @eslint/js 9→10, @electron-toolkit/utils 3→4.
12. Implement semantic Figma node diff (the original eval-vs-sample-corporate finding).
13. Implement named ignore_regions YAML configuration.
14. Wire bench (`scripts/eval/figdiff-cluster-bench.mjs`) into CI as a perf gate.

---

## §6 — Surface vs Root Cause (essential thinking applied retroactively)

| Surface fix shipped | Root cause it does NOT address |
|---|---|
| Coverage gate (PR #53) | Weak test discipline in desktop component / Electron IPC / packaging layers. Threshold prevents drop, does not raise the floor. |
| Pnpm overrides (this PR) | No upgrade SLA / no policy that blocks shipping on high-risk CVE counts. Override is per-CVE patch, not a governance fix. |
| Individual UX fixes from #49 (when applied) | No continuous a11y/UX regression system in CI. |
| Release CI exists (#44, #46) | No release acceptance standard covering signed artifacts, notarization, smoke install, rollback, update behavior. |
| Zod schemas at boundaries | Persistence semantics (atomic write, backup, migration, recovery, corruption tests) — this audit fixed atomic write, others remain. |
| `console.warn/error` logging | No diagnostic contract for compare inputs, Figma fetches, pixel pipeline stages, user-reported failures. |

The pattern: every shipped surface fix has a corresponding root cause that needs a process / policy / system change, not another patch. The follow-up issues in §5.g are framed in that direction.

---

## §7 — "Looks correct from reading the code" claims that are NOT verified end-to-end

Per `god-in-details` + codex findings:

1. **"Release CI means deploy-ready"** — no real packaged artifact has been installed and launched on a clean macOS / Windows / Linux machine; no notarization status confirmed.
2. **"Token storage is secure"** — `safeStorage` calls exist in `app/desktop/electron/util/safe-storage.ts`, but no packaged-app verification that credentials are encrypted at rest, not surfaced in any log, and unreadable after corruption or migration.
3. **"Pixel diff works for the product"** — unit tests + sample reports do not prove real Figma export vs live implementation under fonts, scaling, animations, auth, responsive breakpoints, antialiasing.
4. **"Coverage gate prevents regressions"** — it covers unit code paths only; it does not exercise Electron overlay loading, project persistence crash recovery, native menus/windows, screenshot visual correctness.
5. **"Atomic project write works"** — added in this PR. Unit-equivalent verified by code-reading the POSIX rename semantics. NOT verified by simulating crash mid-write (would need a test that SIGKILLs between write and rename).
6. **"Language switcher persists across restarts"** — switcher exists at `setting-dialog.tsx:148`. `i18n.changeLanguage(...)` is called but persistence mechanism not verified.

These are recorded as known limitations rather than hidden as if verified.

---

## §8 — Anti-laziness rule application log

| Decision considered | SELF-KICK applied? | Resolution |
|---|---|---|
| Defer entire dependabot triage to follow-up | Yes | 10 of 45 fixed in-session via overrides. |
| Defer atomic write to follow-up | Yes | Fixed in-session in `project.ts`. |
| Submit shallow codex prompt to avoid hang | Yes | Rewrote prompt to be ruthlessly adversarial; codex disagreed with 11 score claims. |
| Mark security 40/100 (original) as "done axis" | Yes | Revised to 25 per codex evidence; integrated overlay CSP finding. |
| Skip Phase 4 because Codex MCP disconnected | Yes | Used local CLI background; full review executed. |
| Pre-mortem with only "low probability" items | Yes | 4 HIGH×HIGH scenarios identified, satisfies ≥3 requirement. |
| Cherry-pick which PRs to count as DONE | Yes | All discussed in jsonl classified across §1.1 / §1.2 / §1.3. |
| Mark any axis 100/100 | N/A — no axis is at 100. | All scores have specific evidence; no fake 100s. |

---

## §8.5 — designdiff Product Evolution Roadmap (post re-eval 2026-05-18)

A follow-up re-evaluation of designdiff against the new sample-corp Figma file `FIGMAFILEKEYSAMPLECORP1` (see companion doc `doc/evaluation-2026-05-18-vs-sample-corporate-v02.md`) overturned 2 of the 3 v0.1.0 "unfit" findings and discovered 1 new critical issue.

### Re-eval delta vs the 2026-05-16 v0.1.0 baseline

| v0.1.0 finding | v0.2 status (today) | Evidence |
|---|---|---|
| Whole-image returned as 1 region | **DISPROVEN** | news-sp now returns 391 spatial regions, contact-sp returns 553. Tight bounding boxes (35×12, 16×20). |
| Spatial localization impossible | **DISPROVEN** | Regions carry x/y/w/h; pointed at specific UI elements rather than the page as a whole. |
| Known intentional deviations: 0 detection | **STILL OPEN** | No allowlist / mask parameter in `compareImages()`. |
| (NEW) Clusterer wall-time scales super-linearly with diff area | **NEW CRITICAL** | 142KB pair = 22.9s. 134KB pair = 52.0s. 467KB pair = >90s timeout. 3MB pair (top-pc) = stalled 17 min and killed. v0.1.0 averaged 1.4s/page. ~16-235× slowdown. |

### Reshaped v0.2 priorities

The "sample-corp unfit" verdict stands but its content has shifted from "semantic / localization weakness" to "performance + missing masks":

- **P0** — Clusterer performance budget + adaptive fallback. Hard wall-clock cap, region count cap (default 100), early-exit when hot-cell ratio >50%, fallback to flood-only at full-image diffs.
- **P0** — `ignoreRegions` mask support in `compareImages()` (closes v0.1.0 finding #3).
- **P0** — Per-cell `matchRate` exposed in `gridSummary`.
- **P1** — Named ignore-region YAML config under `~/.figdiff/projects/<id>/ignore-regions.yaml`.
- **P1** — Region count cap with hierarchical merging (391-553 raw → ≤50 user-visible groups).
- **P2** — Per-region threshold override (text vs icons vs photos).
- **P3** — Semantic Figma node diff. **Downgraded** from §5.g's "high-leverage follow-up" — the spatial-region-based approach now covers the practical workflow once masks + perf land.

### Linkage to §5.g follow-up inventory

Original §5.g item #12 was "Implement semantic Figma node diff (the original eval-vs-sample-corporate finding)." After this re-eval, that single line splits into 3 concrete follow-up issues:

- designdiff issue #2 (P0): clusterer performance budget + adaptive fallback
- designdiff issue #3 (P0): `ignoreRegions` mask support
- designdiff issue #4 (P1): per-project ignore-regions YAML

Semantic node diff drops to P3 because pixel-diff + spatial regions + masks + per-cell match% now covers the design-review workflow for the projects we actually use this on.

---

## §9 — Final composite verdict

**Composite score: 44.5 / 100** (17 axes, post-adversarial revision).

The project ships pixel-diff functionality, has working CI, has a meaningful test suite, and the recent week landed 5 PRs that meaningfully advance the foundation. But:

- **Security posture is weak** (Electron 35 stale + overlay CSP gap + 35 open alerts after this audit fixed 10).
- **Deploy readiness is theatrical** (CI exists, signing does not).
- **The product's core claim** ("compare Figma to implementation") is undermined by the eval-vs-sample-corporate finding that pixel diff alone is noisy on real sites — and the semantic Figma node diff that would differentiate the tool **has not been built**.

This audit ships incremental improvements (security overrides, atomic writes, SECURITY.md, this doc) but the structural fixes (Electron upgrade, native E2E, release-integrity, semantic diff) are tracked as follow-up issues for the next sprint.

The honest grade is D+. To move to B requires the 14 follow-up items in §5.g, in particular the top-3 codex actions.
