# Implementation Plan: Ignore-Regions YAML and Cluster Budget Telemetry

## Decision

All five enhancement items are in scope.

1. Mandatory worktree paths are required because the main `develop` checkout has unrelated WIP.
2. Codex Cloud delegation hints are required for long-running implementation and verification work.
3. Budget-exhaustion telemetry is required because fallback without an observable reason causes silent quality drift.
4. Zod validation for YAML is required at the file boundary.
5. Atomic YAML writes are required because persisted masks must survive interrupted writes.

## Worktree Strategy

Do not implement from `/Users/kouiso/ghq/kouiso/designdiff`.

Use these exact worktrees:

| PR | Branch | Worktree path | Scope |
|---|---|---|---|
| P0 | `feat/cluster-budget-telemetry` | `/Users/kouiso/ghq/kouiso/designdiff-worktrees/p0-cluster-budget-telemetry` | Cluster budget caps, fallback telemetry, result schema |
| P1 | `feat/ignore-regions-yaml` | `/Users/kouiso/ghq/kouiso/designdiff-worktrees/p1-ignore-regions-yaml` | Per-project YAML store, Zod schema, atomic write, MCP tools |

Create both worktrees from current `origin/develop` and keep them independent. If `git worktree add` fails because git-crypt is locked, unlock git-crypt first. If this is impossible and the work does not touch encrypted paths, use a filter-disabled checkout only for the isolated worktree creation and document that fact in the PR.

## Delegation

Use Codex Cloud for implementation-heavy and verification-heavy steps when the environment is available. Keep Claude focused on design judgment, review, and final acceptance.

Codex Cloud task prompts must include:

- Absolute worktree path.
- Exact target files.
- Explicit success criteria.
- Verification command.
- Constraint: do not modify files outside the assigned worktree.

If Codex Cloud is unavailable, use local Codex CLI/MCP with the same prompt shape.

## PR 1: Cluster Budget Telemetry

### Goal

Make clusterer fallback visible in `compare_design` output so users and agents can tell when quality degraded due to a budget or fallback path.

### Key Files

| File | Operation | Purpose |
|---|---|---|
| `package/shared/src/diff-cluster.ts` | Modify | Add budget options and structured cluster telemetry from grid clustering. |
| `package/shared/src/schema.ts` | Modify | Add `ClusterTelemetrySchema` and expose it through `CompareDesignResultSchema`. |
| `package/shared/src/type.ts` | Modify | Export inferred telemetry types. |
| `app/mcp-server/src/service/image-compare-service.ts` | Modify | Populate telemetry for selected mode, fallback reason, elapsed time, and budget exhaustion. |
| `app/mcp-server/src/service/image-compare-service.test.ts` | Modify | Test fallback telemetry when grid produces no regions and flood fallback runs. |
| `package/shared/src/diff-cluster.test.ts` | Modify | Test budget exhaustion behavior at the clusterer boundary. |
| `docs/api/diff-report-schema.md` | Modify | Document the new telemetry fields. |

### Data Shape

Add a result field named `clusterTelemetry`:

```ts
type ClusterTelemetry = {
  requestedMode: "auto" | "grid" | "flood";
  usedMode: "grid" | "flood";
  fallbackUsed: boolean;
  fallbackReason?: "grid-empty-with-diff" | "wall-budget-exceeded" | "region-count-exceeded" | "hot-cell-ratio-exceeded";
  wallMs: number;
  budgetMs?: number;
  regionCount: number;
};
```

Use a Zod schema in `package/shared/src/schema.ts`. Do not use ad hoc type guards.

### Acceptance Criteria

- `compare_design` structured output contains `clusterTelemetry`.
- When grid fallback fires, `fallbackUsed` is `true` and `fallbackReason` is present.
- When a budget cap fires, output shows `fallbackReason: "wall-budget-exceeded"`.
- Existing compare output remains backward-compatible because the new field is additive.

### Verification

```bash
pnpm --filter @figdiff/shared test
pnpm --filter @figdiff/mcp-server test
pnpm --filter @figdiff/mcp-server typecheck
```

## PR 2: Ignore-Regions YAML

### Goal

Persist named ignore regions per project at `~/.figdiff/projects/<projectId>/ignore-regions.yaml`, validate YAML with Zod, write atomically, and auto-apply the stored regions during comparison.

### Key Files

| File | Operation | Purpose |
|---|---|---|
| `app/mcp-server/package.json` | Modify | Add direct `yaml` dependency. |
| `package/shared/src/schema.ts` | Modify | Add YAML file and entry schemas based on `IgnoreRegionSchema`. |
| `package/shared/src/type.ts` | Modify | Export inferred YAML config types. |
| `app/mcp-server/src/service/ignore-region-store.ts` | Add | Read, validate, merge, and atomically write YAML configs. |
| `app/mcp-server/src/service/ignore-region-store.test.ts` | Add | Cover missing file, invalid schema, filtering, and atomic write behavior. |
| `app/mcp-server/src/service/compare-design-runner.ts` | Modify | Load persisted regions when `project_id` is present and merge with explicit `ignore_regions`. |
| `app/mcp-server/src/tool/compare-design.ts` | Modify | Document persisted YAML behavior. |
| `app/mcp-server/src/tool/verify-fix.ts` | Modify | Apply the same persisted masks so prior/current comparisons stay aligned. |
| `app/mcp-server/src/tool/get-ignore-regions.ts` | Add | MCP read tool for persisted masks. |
| `app/mcp-server/src/tool/set-ignore-regions.ts` | Add | MCP write/upsert tool for persisted masks. |
| `app/mcp-server/src/server.ts` | Modify | Register the new tools. |
| `docs/api/mcp-tools.md` | Modify | Document YAML path, schema, tools, and precedence. |

### YAML Schema

Use this external shape:

```yaml
version: 1
regions:
  - id: wordpress-copy
    label: WordPress original copy
    frame_name: Top PC
    x: 120
    y: 480
    width: 640
    height: 220
    note: Intentional CMS text difference
```

Validation rules:

- `version` must be `1`.
- `regions` must be an array.
- `id` must match `^[a-zA-Z0-9_-]+$`.
- `frame_name` is optional. If omitted, the region applies to every frame in that project.
- `x`, `y`, `width`, and `height` must reuse `IgnoreRegionSchema` constraints.
- Unknown top-level or region-level keys should fail validation with a clear error.

### Merge Rules

1. If `project_id` is absent, use only explicit `ignore_regions`.
2. If `project_id` is present, load persisted YAML regions for the current `frame_name`.
3. Merge persisted regions first, then explicit `ignore_regions`.
4. Do not silently ignore invalid YAML. Return an MCP error with the project id, path, and Zod issue summary.

### Atomic Write Rules

Write YAML through this sequence:

1. Create the project directory with `recursive: true`.
2. Write to a temp file in the same directory, for example `.ignore-regions.yaml.<pid>.<timestamp>.tmp`.
3. `rename` the temp file to `ignore-regions.yaml`.
4. On write failure, attempt to remove the temp file.

Do not use direct `writeFile` to the final YAML path.

### Acceptance Criteria

- `compare_design` automatically applies stored YAML masks when `project_id` is provided.
- `verify_fix` applies the same stored masks by default.
- Invalid YAML fails at the boundary with a Zod-derived message.
- Interrupted writes cannot leave a truncated final YAML file.
- Explicit one-off `ignore_regions` still work and override nothing by deletion.

### Verification

```bash
pnpm --filter @figdiff/mcp-server test
pnpm --filter @figdiff/mcp-server typecheck
pnpm --filter @figdiff/shared test
pnpm --filter @figdiff/shared typecheck
```

## Review Checklist

- Confirm both PRs were implemented in the required worktree paths.
- Confirm no unrelated dirty files from the main checkout appear in either PR.
- Confirm schema changes are additive or documented as intentional.
- Confirm YAML parsing uses `yaml` plus Zod, not hand-written structural checks.
- Confirm YAML writes use temp-file plus same-directory rename.
- Confirm fallback/budget telemetry is present in structured MCP output and covered by tests.

## Suggested Order

1. Start both worktrees in parallel.
2. Implement P0 telemetry first if one PR must land before the other, because it reduces observability risk for later visual-diff work.
3. Implement P1 YAML after the P0 schema shape is stable, or in parallel if the shared schema edits are coordinated.
4. Run each PR's scoped verification commands.
5. Run full `pnpm test` only after both PRs are integrated or before marking a combined release candidate ready.
