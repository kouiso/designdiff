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
