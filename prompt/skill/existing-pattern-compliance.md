# Existing Pattern Compliance

## Before Writing Code

1. Read existing files in the same directory
2. Match naming patterns (kebab-case files, singular folders)
3. Match import patterns (type imports, import groups with newlines)
4. Match component patterns (functional components, shadcn/ui primitives)

## Rust Patterns

- Error type: `FigDiffError` in `error.rs`
- Tauri commands: `async fn` returning `Result<T, FigDiffError>`
- Figma client: `FigmaClient::new(token)` then method calls
- Serialization: `serde::Serialize` + `serde::Deserialize`

## React Patterns

- UI primitives: `src/component/ui/` (shadcn-style)
- Page components: `src/component/{page}/`
- Stores: `src/store/{name}-store.ts` with Zustand `create()`
- Tauri calls: Always through `src/lib/tauri-command.ts`
