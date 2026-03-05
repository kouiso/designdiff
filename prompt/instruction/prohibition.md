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
