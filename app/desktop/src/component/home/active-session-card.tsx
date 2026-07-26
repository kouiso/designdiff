import { CircleHelp, Zap } from "lucide-react";

import type { ActiveSessionPayload } from "@/store/active-session-store";

interface ActiveSessionCardProps {
  session: ActiveSessionPayload;
  onOpen: () => void;
}

export const ActiveSessionCard = ({ session, onOpen }: ActiveSessionCardProps) => {
  const matchPct = Math.round(session.matchRate);
  const hasUrl = Boolean(session.implementationUrl);
  // UNCERTAIN は自走ループが止まって人の判断を待っている状態。
  // 「実装中」と出すと、いちばん人が見るべき比較が進行中に見えてしまう。
  const needsReview = session.status === "UNCERTAIN";
  const accent = needsReview ? "var(--warn, #b45309)" : "var(--cobalt, #3b82f6)";
  const Icon = needsReview ? CircleHelp : Zap;

  return (
    <div
      style={{
        border: `1px solid ${needsReview ? "var(--warn-line, #b45309)" : "var(--cobalt-line, #3b82f6)"}`,
        borderRadius: "var(--radius-sm-token)",
        background: needsReview
          ? "var(--warn-soft, rgba(180,83,9,0.08))"
          : "var(--cobalt-soft, rgba(59,130,246,0.08))",
        padding: "10px 14px",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <Icon size={15} style={{ color: accent, flexShrink: 0 }} />
      <span style={{ color: "var(--fg)", fontSize: 13, flex: 1 }}>
        {needsReview ? "人の確認待ち — 判定できず" : `AI が実装中 — match ${matchPct}%`}{" "}
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
