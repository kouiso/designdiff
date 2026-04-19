import type { DiffVerdict } from "@figdiff/shared";

import { Badge } from "@/component/ui/badge";
import { cn } from "@/lib/util";

const verdictClassName: Record<DiffVerdict, string> = {
  pass: "border-transparent bg-emerald-500 text-white",
  fail: "border-transparent bg-rose-500 text-white",
  inconclusive: "border-transparent bg-amber-500 text-white",
};

const verdictLabel: Record<DiffVerdict, string> = {
  pass: "PASS",
  fail: "FAIL",
  inconclusive: "INCONCLUSIVE",
};

export function CompareVerdictBadge({ verdict }: { verdict: DiffVerdict }) {
  return (
    <Badge
      className={cn("w-fit px-3 py-1 font-bold tracking-wide", verdictClassName[verdict])}
      data-testid="compare-verdict-badge"
    >
      {verdictLabel[verdict]}
    </Badge>
  );
}
