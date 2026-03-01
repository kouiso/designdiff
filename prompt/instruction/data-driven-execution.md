---
applyTo: "**"
---

# Data-Driven Execution Protocol (LITE)

Apply data science thinking to AI execution processes. These strategies govern HOW to work efficiently, not WHAT to build.

Inspired by production techniques from ABEJA's recommendation systems: multi-stage pipelines, weighted scoring, and LLM-as-Judge self-evaluation.

---

## Section 0: Model Hierarchy & Agent Delegation

### Lead Model
All primary reasoning, architectural decisions, and user-facing responses use **Opus** (claude-opus-4-6).

### Subagent / Teammate Model
All delegated subtasks use **Sonnet** (claude-sonnet-4-6) by default.

```
When launching subagents via Task tool:
  → model: "sonnet" (default for all subagents)
  → Exceptions requiring model: "opus": security review, architecture design
  → For lightweight searches: model: "haiku"

When creating agent teams:
  → Each teammate: model: "sonnet"
  → Lead/orchestrator: the current session (Opus)

When the current session is already Sonnet:
  → Skip Task delegation for simple subtasks (no benefit from same-model delegation)
  → Use model: "haiku" for lightweight parallel searches
```

---

## Section 2: Multi-Stage Pipeline Search

**Activation**: When investigating a codebase, searching for files, or analyzing impact scope.

Use funnel-shaped exploration. Never read files linearly.

```
Stage 1 — Broad Scan
  Tool: Glob, Grep
  Goal: Collect ALL potentially relevant candidates
  Report: "Stage 1 complete: N files found. Proceeding to scoring..."

Stage 2 — Relevance Scoring
  For each candidate, estimate relevance (0.0-1.0) based on:
    - File name match to task keywords
    - Import/export relationship to known target files
    - Recency of modification
  Keep: top candidates only

Stage 3 — Deep Dive
  Read only the top 10 files (ranked by dependency reference count)
  Report: "Stage 3: Reading N files..."

Stage 4 — Cross-Reference
  From deep-dive findings, discover NEW related files
  → Feed back to Stage 2 for scoring
  → Stop when no new high-relevance files are discovered
```

**Prohibitions**: Never read all files in a directory sequentially. Never read a file without scoring its relevance first.

---

## Section 3: Hypothesis-Driven Debugging

**Activation**: When debugging errors, test failures, or unexpected behavior.

```
1. GENERATE: List 3-5 hypotheses for the root cause
2. SCORE each (internally, do not display scores by default):
   Prior Probability (0.0-1.0): Based on error message, stack trace, past patterns
   Ease of Verification (0.0-1.0): 1/steps_needed
   Priority = Prior × Ease
3. TEST: Verify highest-priority hypothesis first
4. RECORD: Log result — confirmed / refuted + evidence
5. UPDATE: Adjust remaining hypotheses, repeat
```

**Prohibitions**: Never try the first idea without listing alternatives. Never persist on one hypothesis after 2 failed attempts without re-evaluating.

---

## Section 6: Multi-Axis Self-Scoring

**Activation**: When finishing a task, before reporting completion.

```
| Axis         | Measurement                                      | Threshold |
|--------------|--------------------------------------------------|-----------|
| Completeness | Acceptance criteria checklist: done/total         | >= 0.9    |
| Accuracy     | Test pass rate + lint error count (0 errors=1.0)  | >= 0.9    |
| Consistency  | Lint warnings: 0=1.0, 1-2=0.8, 3+=0.6           | >= 0.8    |
| Efficiency   | Planned turns vs actual turns (ratio <= 1.0=max)  | >= 0.7    |

Total = Completeness × 0.35 + Accuracy × 0.35 + Consistency × 0.15 + Efficiency × 0.15

IF Total < 0.85: Self-improve before reporting
IF any axis < threshold: Focus improvement on that axis
IF Total >= 0.85 AND all axes pass: Report completion with scores
```

---

## Activation Summary

| Context Detected | Sections Activated |
|---|---|
| Codebase investigation needed | Section 2 (Multi-Stage Pipeline) |
| Error/bug/test failure | Section 3 (Hypothesis-Driven Debugging) |
| Task completion (any size) | Section 6 (Self-Scoring) |
| Launching subagents/teams | Section 0 (Model Hierarchy) |
