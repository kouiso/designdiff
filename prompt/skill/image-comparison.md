# Image Comparison Patterns (Phase 2+)

## pixelmatch

Core comparison engine. Compares two images pixel-by-pixel.

```typescript
const numDiffPixels = pixelmatch(img1, img2, diff, width, height, {
  threshold: 0.1,  // Color difference threshold (0-1)
  alpha: 0.1,
  includeAA: false,
});
```

## Diff Region Clustering

After pixelmatch identifies differing pixels:
1. Cluster adjacent diff pixels into regions
2. Expand regions by a small margin
3. Map regions to Figma node positions

## Image Resize

Both images must be the same dimensions before comparison.

- Desktop (Rust): `image` crate for resize
- MCP Server (Node): `sharp` for resize

## Types (from @figdiff/shared)

```typescript
interface CompareDesignResult {
  matchPercentage: number;
  diffImageBase64: string;
  diffRegions: DiffRegion[];
}

interface DiffRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  severity: "low" | "medium" | "high";
}
```
