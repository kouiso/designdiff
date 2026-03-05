# TypeScript Guidelines

**Any rule violation results in immediate task failure. No exceptions.**

## Strict Rules

- `strict: true` in tsconfig
- No `any` type (warn in ESLint)
- No type assertions (`as` keyword forbidden by ESLint)
- **Exception**: `as const` is actively encouraged (READONLY type guarantee)
- Prefer `type` imports for type-only imports
- All Tauri IPC calls go through `src/lib/tauri-command.ts`
- Arrow functions as default (`const foo = () => {}`)

## Complete Prohibition of `any` Type

- **Targets**: `as any`, `any[]`, `: any`, `<any>`, `Promise<any>`
- **Fixes**: Proper type definitions, minimal interfaces, zod schemas, generics

```typescript
// ❌ Prohibited
const data: any = invoke('get_frames')
const items: any[] = response

// ✅ Correct
const data: Frame[] = await invoke<Frame[]>('get_frames')
const items: DiffRegion[] = response
```

## Complete Prohibition of Type Assertions (`as`)

- **Targets**: `as any`, `as unknown`, `as SomeType`
- **Exception**: `as const` only
- **Fixes**: Type guards, zod `safeParse`, discriminated unions, proper generics

```typescript
// ❌ Prohibited
const result = await invoke('compare') as CompareDesignResult
const frame = data as Frame

// ✅ Correct: Use Tauri invoke with generic
const result = await invoke<CompareDesignResult>('compare')

// ✅ Correct: Type guard
const isFrame = (data: unknown): data is Frame =>
  frameSchema.safeParse(data).success
```

## Mandatory Use of Type Utilities

- ✅ `Omit<T, K>`, `Pick<T, K>`, `Partial<T>`, `Required<T>`, `Record<K, T>`, `Readonly<T>`
- ✅ Combinations: `Omit<Project, 'id'> & { customField: string }`

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
- Props types: `ComponentName` + `Props` (e.g., `type FrameViewerProps = { ... }`)
- shadcn/ui components in `src/component/ui/`
- Page components in `src/component/{page-name}/`
- Hooks in `src/hook/`

## Scenarios Where AI Tends to Use `as` — Correct Alternatives

**This section prevents the loop of "write `as` → get flagged → fix → write `as` again."**

### Scenario 1: Tauri IPC Response

```typescript
// ❌ AI keeps writing this
const frames = await invoke('get_frames') as Frame[]

// ✅ Correct: Use generic parameter
const frames = await invoke<Frame[]>('get_frames')
```

### Scenario 2: Zustand Store Selectors

```typescript
// ❌ AI keeps writing this
const theme = useSettingStore((s) => s.theme) as Theme

// ✅ Correct: Store is already typed — no assertion needed
const theme = useSettingStore((s) => s.theme) // already Theme type
```

### Scenario 3: Enum/Union in Array Operations

```typescript
// ❌ AI keeps writing this
const items = options.map((opt) => ({ value: opt.value as DesignProvider }))

// ✅ Correct: Constrain source type
type ProviderOption = { label: string; value: DesignProvider }
const options: ProviderOption[] = [...]
```

### Scenario 4: Event Handler Callbacks

```typescript
// ❌ AI keeps writing this
onChange={(v) => setProvider(v as DesignProvider)}

// ✅ Correct: Type guard
const isDesignProvider = (v: string): v is DesignProvider =>
  (['FIGMA', 'XD'] as const).includes(v as DesignProvider)
```

### Scenario 5: Null/Undefined Narrowing

```typescript
// ❌ AI keeps writing this
const frame = frames.find((f) => f.id === id) as Frame

// ✅ Correct: Handle undefined
const frame = frames.find((f) => f.id === id)
if (!frame) throw new Error(`Frame not found: ${id}`)
```

### Anti-Loop Checklist

**Before writing type conversion code, STOP and check:**

1. Can I use Tauri invoke's generic parameter? (Scenario 1)
2. Is the store already typed? (Scenario 2)
3. Can I constrain the source type? (Scenario 3)
4. Can I use a type guard? (Scenario 4)
5. Can I narrow with a conditional? (Scenario 5)

**If ALL are "no", the architecture is wrong. Redesign it.**
