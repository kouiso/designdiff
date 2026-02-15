# Performance Guidelines

## Image Processing

- Cache Figma images at `~/.figdiff/cache/` to avoid redundant API calls
- Use Rust `image` crate for server-side resize (desktop)
- Transfer images as base64 strings over Tauri IPC
- Use `scale: 2` for Figma frame images by default

## Figma API

- Respect rate limits (avoid rapid sequential calls)
- Use `depth=1` for frame listing (minimize payload)
- Cache file structure responses when possible

## React

- Use Zustand selectors to prevent unnecessary re-renders
- Lazy-load heavy components (image comparison views)
- Use `useMemo`/`useCallback` for expensive computations
