import { Zap } from "lucide-react";

import type { ActiveSessionPayload } from "@/store/active-session-store";

interface ActiveSessionCardProps {
  session: ActiveSessionPayload;
  onOpen: () => void;
}

export const ActiveSessionCard = ({ session, onOpen }: ActiveSessionCardProps) => {
  const matchPct = Math.round(session.matchRate);
  const hasUrl = Boolean(session.implementationUrl);

  return (
    <div
      style={{
        border: "1px solid var(--cobalt-line, #3b82f6)",
        borderRadius: "var(--radius-sm-token)",
        background: "var(--cobalt-soft, rgba(59,130,246,0.08))",
        padding: "10px 14px",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <Zap size={15} style={{ color: "var(--cobalt, #3b82f6)", flexShrink: 0 }} />
      <span style={{ color: "var(--fg)", fontSize: 13, flex: 1 }}>
        AI が実装中 — match {matchPct}%{" "}
        <span style={{ color: "var(--muted-fg)", fontSize: 12 }}>({session.designSource})</span>
      </span>
      {hasUrl && (
        <button
          type="button"
          className="fd-btn primary"
          onClick={onOpen}
          style={{ fontSize: 12, padding: "4px 10px" }}
        >
          見にいく
        </button>
      )}
    </div>
  );
};
