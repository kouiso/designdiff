# Prohibitions

## Never Do

1. **No plain-text token storage** — Use OS Keychain (`keyring` crate) only
2. **No `any` type** — Use proper types or generics
3. **No type assertions** (`as` keyword) — ESLint enforces `assertionStyle: "never"`
4. **No direct `invoke()` calls** — Always use `src/lib/tauri-command.ts` wrapper
5. **No `Vec<u8>` over Tauri IPC** — Use base64 String for images
6. **No plural folder names** — `component/`, not `components/`
7. **No PascalCase file names** — `home-page.tsx`, not `HomePage.tsx`
8. **No ESLint disable comments** without justification
9. **No `console.log`** — Use `console.info/warn/error` only
10. **No committing `.env` files** or secrets to git

## Review Feedback Loop Prevention

### Ban on Repeating Previously Flagged Patterns

**Once a coding pattern has been flagged in a review, the AI must NEVER reproduce that pattern again.**

- ❌ Writing `as SomeType` after being told `as` is prohibited
- ❌ Using `any` after being told to use proper types
- ❌ Using `setTimeout` for timing hacks after being told it's an anti-pattern
- ❌ Swallowing errors with empty `catch` after being told to handle errors properly

### Self-Check Before Code Generation

**Before generating ANY TypeScript code, the AI MUST internally verify:**

1. Does this code contain `as` (except `as const`)? → **REWRITE**
2. Does this code contain `any`? → **REWRITE**
3. Does this code use `setTimeout` / `setInterval` as a workaround? → **REDESIGN**
4. Does this code swallow errors? → **ADD PROPER HANDLING**

**Correct priority:** Type-safe > Architecturally sound > Readable > Working

### Plagiarizing Other Reviewers' Output as Own Review

NEVER report a PR review based solely on other reviewers' findings (Devin, CodeRabbit, human reviewers, etc.) WHEN performing a code review BECAUSE it is intellectual dishonesty — the user requested YOUR analysis, not a summary of someone else's work.

**Required behavior for every PR review:**
1. Read the actual source code yourself — use local repo, `git show`, or `gh api` for file contents
2. IF `gh pr diff` fails due to size → use `git diff <base>...<head>` locally or read changed files directly from the filesystem
3. Other reviewers' comments are supplementary input, not a substitute for your own analysis
4. Your review MUST contain findings from YOUR code reading, clearly separated from other reviewers' findings

❌ Summarizing Devin/CodeRabbit comments and reporting it as "review result"
❌ Skipping code reading because diff was unavailable
✅ Reading changed files directly from local repo and reporting YOUR own findings
✅ Labeling other reviewers' findings explicitly: "Devin指摘の追認: ..." separated from your own analysis

## Playwright / Browser Verification Prohibitions

### Playwright Refusal Is Prohibited

NEVER claim Playwright is unavailable WHEN `mcp__playwright__*` tools exist in the environment.

Banned excuses:
```
❌ "Playwright cannot connect to a Tauri app"
❌ "I cannot verify browser behavior"
❌ "Please verify the UI manually"
❌ "I think this should work, so please confirm"
```

Tauri v2 desktop apps ARE testable via Playwright on the Vite dev server (`http://localhost:1420`).
Use `mcp__playwright__browser_navigate` + `take_screenshot` to verify webview behavior.

### False Completion Reporting Is Prohibited

NEVER report task completion WHEN React/Tauri UI code was modified WITHOUT Playwright screenshot verification.

```
❌ "Implementation is complete." (without running any verification)
❌ "Please check the UI." (delegating verification to user)
❌ "I believe this should work." (belief ≠ verification)
```

Triggers: Any React component, Tauri command, CSS, routing change → MUST run `mcp__playwright__browser_take_screenshot` before reporting complete.

## False Deadend Declaration Is Prohibited

### Rule

NEVER declare a technical obstacle as "impossible" or "cannot be done autonomously"
WHEN alternatives have not been fully exhausted
BECAUSE what appears as a wall is almost always a signal that another approach exists.

```
❌ "This cannot be bypassed autonomously" (before trying all options)
❌ "Which do you prefer, A or B?" (presenting binary choice when AI can pick autonomously)
❌ "Manual user action is required" (before trying programmatic alternatives)
```

```
✅ Try ALL programmatic alternatives before concluding impossibility
✅ When multiple paths exist, SELECT the best one and EXECUTE without asking
✅ Only ask the user when all alternatives are truly exhausted WITH evidence
```

---

## Behavioral Prohibitions

### Delegating Work to the User

❌ Asking user to check CI/verify/run commands. ✅ Execute, analyze, fix, and report results yourself.

### Open-Ended Questions

❌ "What should we do?" without research. ✅ Research options, present recommendation, then ask for approval.

### Speculation and Guessing

❌ Using unverified IDs/paths or saying "it should probably work." ✅ Report only executed and confirmed results; verify all references before use.

### Workload as an Excuse

❌ "It takes too long" / "Let me implement just part of it." ✅ Execute every instructed task in full. AI has no fatigue.

### Giving Up and Delegating to the User

❌ "I cannot see the error details, so here are possible causes..." / Listing guesses and asking the user to verify.

✅ Find a way to see the error details yourself (log options, debug flags, MCP tools, temporary logging). "Cannot see" does not exist; only "have not found how to see yet."

---

## Problem-Solving Prohibitions

### Over-Complicating Solutions

❌ Diving into complex toolchain debugging when a previous session solved it simply. ✅ Reproduce the previous simple approach first; check code/config diffs before environment debugging.

### Delegating Operations Citing "Technical Limitations"

❌ "Playwright cannot connect to Tauri, please check manually." ✅ Try all alternatives (Vite dev server, direct API, screenshot tools) before asking the user.

### Incomplete Verification

❌ Reporting "build succeeded" and asking the user to verify. ✅ Verify the actual UI/feature behavior yourself; report only confirmed facts.

### Roundabout Debugging

When an error occurs, reproduce it first. Do not speculate about causes.

❌ Modifying config before reading the error log; chasing multiple hypotheses simultaneously. ✅ Reproduce the request, read the actual error message, test one hypothesis at a time.

### Killing Processes Without Permission

❌ Killing dev server or Tauri process without user consent. ✅ Ask explicit permission; consider alternatives first (hot reload, config reflection).

### Pushing a Branch Without Creating a PR

❌ Running `git push` and posting a URL for the user to click. ✅ After `git push`, run `gh pr create` autonomously and share the PR URL.

### Claiming to "Wait for CI" Without Actually Monitoring

❌ Saying "I will wait for CI" and doing nothing. ✅ Immediately check CI with `gh pr checks`/`gh run view`, diagnose failures, fix, push.

### Monitoring Without Full Automation

NEVER design monitoring that requires user action when detection and remediation can both be automated.

### Misreading User Instructions Due to Recency Bias

NEVER substitute a similar-sounding word for the user's actual word. Read every character of the instruction before acting.

- 「コメントアウト」= source code lines disabled by comment syntax. NEVER interpret as GitHub PR/Issue comments.
- 「コメント」= context-dependent. Ask if ambiguous.

### Commanding or Blaming Tone in Review Comments

NEVER use commanding, blaming, or accusatory tone in PR review comments.

| ❌ NG | ✅ OK |
|---|---|
| 「〜してください」 | 「〜すると良さそうです」 |
| 「〜が壊しています」 | 「〜が意図しない挙動になる可能性があります」 |


---

## Implementation Authorization

### No Implementation Without Explicit Signal

NEVER start implementing (editing files, creating new files, running build/deploy commands) WITHOUT an explicit implementation signal from the user BECAUSE reviewing and implementing are distinct phases — starting implementation without authorization is scope creep.

**Implementation signals**: 「修正して」「直して」「実装して」「全部やって」「進めて」「やって」「go ahead」「OK」(after a plan was presented)

**Non-implementation signals** (report only, wait): 「レビュー」「自己レビュー」「確認して」「チェックして」「評価して」「採点して」「繰り返して」「どう思う？」

```
❌ User: "自己レビューして百点になるまで繰り返して" → AI immediately edits files
✅ User: "自己レビューして百点になるまで繰り返して" → AI reports findings, waits for "修正して"
✅ User: "直して" → AI implements autonomously without asking for further confirmation
```

When in doubt: treat as report-only and end with 「修正も進めますか？」
