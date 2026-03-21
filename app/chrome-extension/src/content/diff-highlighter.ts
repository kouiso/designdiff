import type { DiffRegion } from "@figdiff/shared";

// =============================================================================
// Diff Highlighter — DiffRegion[] をページ上の赤ハイライトボックスとして表示
// =============================================================================

const HIGHLIGHT_CONTAINER_ID = "figdiff-diff-highlights";

export function showDiffHighlights(
  regions: DiffRegion[],
  imageWidth: number,
  imageHeight: number,
): void {
  removeDiffHighlights();

  const container = document.createElement("div");
  container.id = HIGHLIGHT_CONTAINER_ID;
  container.style.cssText = `
    position: fixed;
    top: 0; left: 0;
    width: 100vw; height: 100vh;
    z-index: 2147483645;
    pointer-events: none;
  `;

  const scaleX = window.innerWidth / imageWidth;
  const scaleY = window.innerHeight / imageHeight;

  for (const region of regions) {
    const box = document.createElement("div");
    const x = Math.round(region.bounds.x * scaleX);
    const y = Math.round(region.bounds.y * scaleY);
    const w = Math.round(region.bounds.width * scaleX);
    const h = Math.round(region.bounds.height * scaleY);

    box.style.cssText = `
      position: absolute;
      left: ${x}px;
      top: ${y}px;
      width: ${w}px;
      height: ${h}px;
      border: 2px solid rgba(255, 0, 0, 0.8);
      background: rgba(255, 0, 0, 0.08);
      box-sizing: border-box;
    `;
    box.title = `Diff region #${region.id}: ${region.diffPixelCount} pixels`;
    container.appendChild(box);
  }

  document.body.appendChild(container);
}

export function removeDiffHighlights(): void {
  document.getElementById(HIGHLIGHT_CONTAINER_ID)?.remove();
}
