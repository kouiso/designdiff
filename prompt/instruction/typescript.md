# TypeScript Guidelines

## Strict Rules

- `strict: true` in tsconfig
- No `any` type (warn in ESLint)
- No type assertions (`as` keyword forbidden by ESLint)
- Prefer `type` imports for type-only imports
- All Tauri IPC calls go through `src/lib/tauri-command.ts`

## Shared Types

All shared types are in `@figdiff/shared` (`package/shared/src/type.ts`):
- `Frame`, `NodeInspection`, `DesignProvider`
- `ParsedDesignInput`, `CompareDesignResult`, `DiffRegion`
- `Project`

## Zustand Stores

- `setting-store.ts`: Figma token, theme, threshold
- `project-store.ts`: Projects, frames, selected frame, image

## React Conventions

- Functional components only
- shadcn/ui components in `src/component/ui/`
- Page components in `src/component/{page-name}/`
- Hooks in `src/hook/`
