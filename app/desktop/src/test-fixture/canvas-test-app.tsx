import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/index.css";
import { useCanvasZoomPan } from "@/hook/use-canvas-zoom-pan";

function CanvasTestPage() {
  const { scale, offset, containerRef, transformStyle, resetZoom } = useCanvasZoomPan({
    initialScale: 1,
  });

  return (
    <div style={{ padding: "20px", height: "100vh", display: "flex", flexDirection: "column" }}>
      <h1 style={{ marginBottom: "10px" }}>Canvas Zoom/Pan Test</h1>
      <div style={{ marginBottom: "10px" }}>
        <span data-testid="scale-value">{Math.round(scale * 100)}</span>%{" | "}
        offset: (<span data-testid="offset-x">{Math.round(offset.x)}</span>,{" "}
        <span data-testid="offset-y">{Math.round(offset.y)}</span>)
        <button
          type="button"
          onClick={resetZoom}
          data-testid="reset-btn"
          style={{ marginLeft: "10px" }}
        >
          Reset
        </button>
      </div>
      <div
        ref={containerRef}
        data-testid="canvas-container"
        style={{
          flex: 1,
          overflow: "hidden",
          border: "2px solid #333",
          position: "relative",
          background: "#f0f0f0",
        }}
      >
        <div style={transformStyle}>
          <div
            data-testid="canvas-content"
            style={{
              width: "400px",
              height: "300px",
              background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              fontSize: "24px",
              fontWeight: "bold",
              userSelect: "none",
            }}
          >
            Test Canvas Content
          </div>
        </div>
      </div>
      {/* スクロール可能な領域（ページスクロールテスト用） */}
      <div
        data-testid="scroll-area"
        style={{
          marginTop: "10px",
          height: "100px",
          overflow: "auto",
          border: "1px solid #ccc",
        }}
      >
        <div style={{ height: "500px", padding: "10px" }}>
          Scrollable content below canvas (should not scroll when cursor is over canvas)
        </div>
      </div>
    </div>
  );
}

const root = document.getElementById("test-root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <CanvasTestPage />
    </StrictMode>,
  );
}
