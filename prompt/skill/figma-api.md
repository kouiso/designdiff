# Figma REST API Patterns

## Authentication

Header: `X-FIGMA-TOKEN: {personal_access_token}`
Stored in OS Keychain, retrieved at command execution time.

## Key Endpoints

| Endpoint | Purpose | FigDiff Command |
|----------|---------|-----------------|
| `GET /v1/files/:key?depth=1` | List frames | `get_figma_frames` |
| `GET /v1/images/:key?ids=:id&format=png&scale=2` | Get image URL | `get_figma_frame_image` (step 1) |
| `GET /v1/files/:key/nodes?ids=:id` | Node details | `get_figma_node_detail` |

## Image Fetch (2-stage)

1. Call `/v1/images/` → returns `{ images: { "node_id": "https://..." } }`
2. Download image from returned URL
3. Cache to `~/.figdiff/cache/{file_key}_{node_id}_{scale}x.png`
4. Encode as base64 and return to frontend

## Node ID Format

- Figma URLs: `node-id=1-23` (dash)
- Figma API: `1:23` (colon)
- `extractNodeId()` handles conversion

## Rate Limits

- Respect Figma rate limits
- Cache responses where possible
- Use `depth=1` to minimize payload for frame listing
