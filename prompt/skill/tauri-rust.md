# Tauri v2 + Rust Patterns

## Command Pattern

```rust
#[tauri::command]
async fn command_name(arg: String) -> Result<ReturnType, FigDiffError> {
    // implementation
}
```

Register in `lib.rs`:
```rust
.invoke_handler(tauri::generate_handler![command_name])
```

## Error Handling

All commands return `Result<T, FigDiffError>`.
`FigDiffError` implements `serde::Serialize` for Tauri IPC.

## Image Transfer

Rust → Frontend: base64 encoded String
```rust
base64::engine::general_purpose::STANDARD.encode(&bytes)
```

Frontend displays: `data:image/png;base64,${base64String}`

## Token Storage

OS Keychain via `keyring` crate:
```rust
let entry = keyring::Entry::new("figdiff", "figma-token")?;
entry.set_password(token)?;
entry.get_password()?;
```

## Capabilities

Defined in `src-tauri/capability/default.json`:
- `core:default` — IPC
- `store:default` — Non-sensitive settings
- `http:default` — Figma API (api.figma.com)
