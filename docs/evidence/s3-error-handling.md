# S3: Error Handling UX — Evidence

## Date
2026-04-14

## Changes Made

File: `package/shared/src/figma-client.ts` — `fetchApi()` method

### Before
```typescript
if (!response.ok) {
  const body = await response.text();
  throw new Error(`Figma API error ${response.status}: ${body}`);
}
```

### After
Per-status user-friendly error messages:
- **401**: `"Figma token is invalid or expired (401). Please update your token in Settings."`
- **403**: `"Access denied (403). You don't have permission to access this Figma file."`
- **429**: `"Figma API rate limit exceeded (429). Please wait {Retry-After} seconds."` (uses Retry-After header when present)
- **5xx**: `"Figma server error ({status}). Please try again later."`
- **Other**: Falls through to original `"Figma API error {status}: {body}"` format

### TOKEN_ERROR_PATTERNS updated
Added two new patterns so `isTokenError()` continues to correctly classify new 401/403 messages:
- `"invalid or expired (401)"`
- `"Access denied (403)"`

## Verification

```
$ pnpm --filter @figdiff/shared typecheck
✓ TypeScript: no errors

$ npx vitest run (in package/shared)
Test Files: 4 passed (4)
Tests: 60 passed (60)
```

## User-Facing Impact

Chrome Extension popup: `state.error` is rendered as text from `background.ts` → the new messages appear directly in the extension popup UI.

Desktop App: `isTokenError()` routes 401/403 messages to `requireToken()` (token settings UI). Other errors appear as `error` state in project view.
