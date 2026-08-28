import { z } from "zod";

import { LoopGuardReportSchema } from "@figdiff/shared";

const LEGACY_MAX_STEPS = 5;
const legacyLoopGuardSchema = z
  .object({
    iteration: z.number().int().positive(),
    decision: z.enum(["continue", "stop"]),
    reason: z.string().min(1),
  })
  .strict();

export const normalizeLegacyLoopGuard = (value: unknown): unknown => {
  const current = LoopGuardReportSchema.safeParse(value);
  if (current.success) {
    return value;
  }

  const legacy = legacyLoopGuardSchema.safeParse(value);
  if (!legacy.success) {
    return value;
  }

  const { iteration, decision, reason: message } = legacy.data;
  const steps = message.match(/(\d+)\s*\/\s*(\d+)/);
  const upperBound = message.match(/上限\s*\((\d+)\s*回\)/);
  const maxStepsText = steps?.[2] ?? upperBound?.[1];
  const parsedMaxSteps = maxStepsText === undefined ? undefined : Number(maxStepsText);
  const maxSteps =
    parsedMaxSteps !== undefined && Number.isSafeInteger(parsedMaxSteps)
      ? Math.max(iteration, parsedMaxSteps)
      : Math.max(iteration, LEGACY_MAX_STEPS);
  const reason =
    decision === "continue"
      ? "continue"
      : message.includes("UNCERTAIN")
        ? "uncertain"
        : message.includes("PASS")
          ? "no-regression"
          : message.includes("上限")
            ? "max-steps"
            : "regression";

  return {
    stop: decision === "stop",
    step: iteration,
    maxSteps,
    remainingSteps: maxSteps - iteration,
    reason,
    message,
    iteration,
    decision,
  };
};
