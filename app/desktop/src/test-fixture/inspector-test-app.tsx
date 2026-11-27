import { StrictMode, useState } from "react";

import "@fontsource-variable/hanken-grotesk";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/noto-sans-jp";
import { createRoot } from "react-dom/client";

import { CompareInspector } from "@/component/compare/compare-inspector";
import { CompareStatusBar } from "@/component/compare/compare-status-bar";

import "@/i18n";
import "@/index.css";
import { buildInspectorFixture } from "./compare-inspector-fixture";

const fixture = buildInspectorFixture();

function InspectorTestPage() {
  const [recompareCount, setRecompareCount] = useState(0);

  return (
    <div
      style={{ background: "var(--bg)", color: "var(--fg)", padding: 16, minHeight: "100vh" }}
      data-testid="inspector-harness"
    >
      <p className="mono text-xs" style={{ marginBottom: 8 }}>
        recompare: <span data-testid="recompare-count">{recompareCount}</span>
      </p>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <div
          style={{
            width: 360,
            height: 760,
            display: "flex",
            flexDirection: "column",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-token)",
            overflow: "hidden",
          }}
        >
          <div style={{ flex: 1 }} />
          <CompareStatusBar compareResult={fixture} />
        </div>
        <div style={{ width: 360, height: 760, display: "flex", flexDirection: "column" }}>
          <CompareInspector
            compareResult={fixture}
            isComparing={false}
            canCompare={true}
            onRecompare={() => setRecompareCount((count) => count + 1)}
            currentFileKey={null}
            projectId={null}
            selectedFrame={null}
          />
        </div>
      </div>
    </div>
  );
}

const rootElement = document.getElementById("test-root");
if (!rootElement) throw new Error("test-inspector.html に #test-root がありません");

createRoot(rootElement).render(
  <StrictMode>
    <InspectorTestPage />
  </StrictMode>,
);
