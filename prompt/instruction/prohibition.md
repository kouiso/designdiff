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
