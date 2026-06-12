---
applyTo: "**/*.ts,**/*.tsx,**/*.js,**/*.jsx,**/*.py,**/*.dart"
---

# Autonomous Execution Protocol

## 0. Agent-First Design

### Delegate Complex Tasks to Specialized Agents

**Core principle**: Delegate complex, multi-step, or domain-specific tasks to specialized agents via `runSubagent`.

### Auto Agent Trigger Rules

**Automatically launch corresponding agents when the following keywords are detected:**

| Trigger Keywords | Agent | Description |
|-----------------|-------|-------------|
| review | multi-review | Multi-agent collaborative review |
| issue, implementation plan | planner | Implementation planning & task decomposition |
| investigate, research, analyze | planner + specialized agents | Deep investigation |
| figma, design, UI/UX | specialized agent | Figma design reading & pixel-accurate implementation |
| architecture | architect | Architecture design & decisions |
| security, vulnerability | security-reviewer | Security audit |
| test, TDD | tdd-guide | Test-driven development |
| error, build failure | build-error-resolver | Build error resolution |
| refactor, cleanup | refactor-cleaner | Code cleanup & refactoring |

**CRITICAL**: When these keywords are detected, **automatically launch agents WITHOUT asking user confirmation**.

### Special Agent Activation Scenarios

| Scenario | Triggers | Action |
|----------|----------|--------|
| Figma Design | "figma", figma URL, "implement this design" | Launch specialized agent, extract precise specs (dimensions, colors, typography, spacing) |
| PR Review | "review", `/review-pr` | Launch multi-review agents in parallel (architecture + security + code quality) |
| Deep Investigation | "investigate", "research" | Launch planner + specialized agents, gather comprehensive info |

### Delegation Criteria

**Delegate to agents when:**
- Task requires 3+ steps
- Domain expertise is needed (security, architecture, etc.)
- Investigation spans multiple files/modules
- Multiple perspectives are needed (reviews, etc.)

**Execute directly when:**
- Simple file edits (1-2 files)
- Steps are clear and well-defined
- User gave specific instructions

### Agent Usage

```markdown
runSubagent({
  description: "Short description (3-5 words)",
  prompt: `
    Detailed task description
    - What the agent must do
    - What information to return
    - Expected deliverables
  `
})
```

### Subagent Prompt Quality Gate (DS/AI Engineering)

**Every subagent prompt must pass the following checks before dispatch.**

| Check | Question | If NO → Fix |
|-------|----------|-------------|
| **Quantifiable Success** | Does the prompt define measurable success criteria? | Add explicit criteria: "return file paths", "list ≤ 10 items", "score 1-5 per dimension". |
| **Output Schema** | Is the expected return format explicitly defined? | Specify exact fields, structure, and constraints. |
| **Semantic Scope** | Is the search/analysis scope clearly bounded? | Define directories, file patterns, or query boundaries. |
| **No Ambiguity** | Are all key terms precisely defined? | Replace subjective words with concrete criteria. |

**Anti-Patterns:**
```markdown
# ❌ Bad: Vague, unbounded, no output schema
Task(prompt: "Check if the code quality is good in the project")

# ✅ Good: Bounded scope, quantifiable, structured output
Task(prompt: `
  Scan all TypeScript files in app/desktop/src/ for:
  1. Functions with cyclomatic complexity > 10
  2. Files with > 300 lines
  Return: | File | Issue | Line | Details |
`)
```

### Mandatory Strict Review of Subagent Output

- Read the full output of each subagent and verify correctness.
- Check for file path errors, reference inconsistencies, and content omissions.
- Fix any issues found immediately before reporting completion.
- **Never blindly trust subagent output**.

---

## 1. Mandatory Self-Research Before Asking

### Core Principle

**Exhaust all self-researchable information before asking the user any question.**

**Decision criteria:**
- Allowed to ask: Information that does not exist in the repo, history, or external tools (user intent, judgment, preferences)
- Prohibited from asking: Objective facts the AI can retrieve through investigation

### Required Self-Research (before any question)

#### Codebase
- Source code contents (Read, Grep, Glob)
- Directory structure (Bash ls, tree, etc.)
- Config files (package.json, tsconfig.json, electron.vite.config.ts, electron-builder.json5, etc.)
- Documentation (README, docs/, document.md, etc.)

#### Git History
- Commit history (`git log`, `git show`)
- Branch info (`git branch`, `git status`)
- Diffs (`git diff`)
- **File/directory deletion history** (`git log --all --full-history -- path/to/file`)

#### GitHub Info
- PR content, comments, reviews (`gh pr view`, `gh pr list`)
- Issue content, comments (`gh issue view`, `gh issue list`)
- GitHub Actions results (`gh run list`, `gh run view`)

**Important**: Issue/PR text is reference material only. The truth lives in git history and the codebase.

#### Issue-Related Document Research

**When working on an Issue, read all related documents in the workspace.**

- Files like `{issue-number}.md`, `docs/{issue-number}.md` may contain analysis/research results
- Investigate past PRs/commits for the same Issue

#### Runtime Environment
- Build/run results (`pnpm dev`, `electron-vite dev`)
- Test results (`pnpm test`)
- Log output (Electron main process console, renderer devtools via playwright)

#### External Information
- Official documentation (WebSearch, WebFetch, Tavily)
- Library specs (npm registry, crates.io, GitHub)
- Error message meanings (WebSearch, Tavily)

**Search tool selection**:
- **Tavily preferred**: Complex research, deep technical info, latest best practices
- **WebSearch**: Simple queries, basic lookups, official docs

### Permitted Questions (AI cannot research)

- **User intent**: "What is the purpose of this feature?"
- **Judgment/priority**: "Which should I prioritize, A or B?" (present technical trade-offs first)
- **Subjective evaluation**: "Is this UI design acceptable?"
- **Business logic**: "What is the business meaning of this formula?"

### Execution Protocol

#### Step 1: Thorough Research
1. Full repo scan: read all file structures, configs, and docs
2. History research: check all related commits, PRs, and Issues
3. Runtime verification: execute commands and verify behavior as needed
4. External research: look up unknown technologies/errors via WebSearch/Tavily

#### Step 2: Decision
- "Can the AI retrieve this information?" → YES: research it. NO: proceed to Step 3.

#### Step 3: Ask (last resort)
- State what was researched: "I checked X but could not determine Y"
- Ask specifically: "Please clarify Z"

---

## 2. Fully Autonomous Execution

### Core Principle

**The user gives instructions. The AI performs all verification, debugging, and testing. Asking the user to perform work is prohibited.**

### Mandatory MCP Usage

**Use all available MCPs proactively. Failing to use an available MCP is negligence.**

**Available MCPs**: See `.vscode/mcp.json` for the full list.

#### Usage Requirements

1. **Research**: Gather info via tavily/github MCP before asking the user
2. **GitHub operations**: Use github MCP or `gh` CLI directly
3. **Figma design verification**: Use figma MCP to fetch latest design specs — never guess dimensions, colors, or spacing
4. **UI behavior verification**: Use playwright to navigate `http://localhost:5173` (Vite dev server) and take screenshots
5. **Code debugging**: Use vscode MCP for breakpoints and step execution

### Autonomous Verification Patterns — Designdiff Specific

- **CI/CD**: `gh run list` → `gh run view` → identify cause → fix → re-run
- **Frontend tests**: `pnpm test` → analyze failures → fix → re-run
- **UI behavior** (playwright): Start `pnpm dev` (background) → `browser_navigate http://localhost:5173` → `take_screenshot` → verify
- **Figma spec**: Use figma MCP → `figma_get_file_nodes` → extract exact measurements → implement → screenshot compare
- **Type errors**: `pnpm typecheck` → analyze errors → fix → re-run
- **Lint errors**: `pnpm lint` / `pnpm lint:eslint` → fix all → re-run

### Desktop App Verification (Electron + electron-vite)

**Electron renderer IS testable via Playwright on the Vite dev server.**

```
Step 1: Start dev server (background)
  → pnpm dev  (starts Vite on http://localhost:5173 + Electron window)

Step 2: Navigate and screenshot
  → mcp__playwright__browser_navigate http://localhost:5173
  → mcp__playwright__browser_take_screenshot

Step 3: Interact and verify
  → mcp__playwright__browser_click / browser_type
  → mcp__playwright__browser_take_screenshot after each action
  → mcp__playwright__browser_snapshot for accessibility tree
```

❌ "Playwright cannot connect to an Electron app" is FALSE and prohibited.

### When the User Says "I'll Do It Myself"

- "I'll do it myself" applies to the specific part only
- The AI silently executes everything else

### Performance Guardrails

- **MCP limit**: Keep enabled MCP servers to 10 or fewer per project
- **Minimal tools per agent**: Give each subagent only the tools it needs
- **Parallel execution**: Execute independent tasks in parallel

### Guiding Principles

- **User's time is the most valuable resource** → waste zero seconds
- **MCPs are weapons** → verify everything you can verify yourself
- **"Please do X" directed at the user is disrespectful** → the AI executes it
- **Full autonomy is the mission** → reduce user burden to zero

---

## 3. Execution Workflow

### Step 1: Deep Analysis & Planning

1. **Full repo scan**: Understand all files, directories, and documentation
2. **Identify applicable rules**: Re-read instruction files related to the task
3. **Requirements definition**: Decompose tasks, identify potential risks
4. **Autonomous technical research**: Research unknowns via Tavily/WebSearch
5. **Propose plan**: Present a concrete execution plan, obtain user approval

### Step 2: Meticulous Implementation

1. Execute each step precisely according to the approved plan
2. Fully replicate existing code style, design philosophy, and naming conventions
3. Follow Biome formatting rules (double quotes, semicolons, 2-space indent, 100 line width)
4. Follow ESLint v9 type-aware rules (no `as`, no `any`)
5. Follow TypeScript naming conventions (kebab-case files, PascalCase types/components)

### Step 3: Rigorous Quality Assurance

1. **Mandatory CI/test execution**: Run `pnpm lint`, `pnpm typecheck`, `pnpm test` after work. Continue until all errors are resolved.
2. **Self-correction loop**: Avoid superficial fixes, identify root causes
3. **Final verification**: Confirm all deliverables fully satisfy requirements — including Playwright screenshot for any UI change

---

## 4. Context Management & Session Fault Tolerance

### Context Management Principles (Session Longevity)

**Separate the "research" context from the "edit" context.**

Loading large volumes of file content into the main context causes context bloat and session failure. Strict rules:

1. **Delegate exploration/research to subagents**
   - Full codebase overview, file exploration, and architecture understanding go to subagents
   - Subagents run in separate contexts; only summaries return to main
2. **Read only files you will edit in the main context**
   - Delegate "just checking" reads to subagents
3. **Run independent research tasks as parallel subagents**
4. **Do not duplicate research already done by subagents**

**Why this matters**: Main context bloat triggers compression, losing early conversation content and breaking the session.

### Image File Handling (Session Death Prevention)

Images (screenshots, Figma exports, etc.) consume thousands of tokens each.

1. **Record images by file path only; never embed inline**
2. **Delegate image verification to subagents**
   - Have subagents read images and return text summaries to main
   - Verify multiple images via parallel subagents
3. **Never re-read images already verified by subagents**

### Session Recovery (Save/Load Mechanism)

#### Progress Persistence via Report Files

At the start of long-running work, create a report file containing:
- **Progress summary table**: Step number, description, status, result
- **Checklist**: [x]/[ ] format for completion tracking
- **Issue log table**: Number, description, severity, resolution status
- **Code change log**: What changed in which files

#### Summary Replication to MEMORY.md

Copy the report summary to MEMORY.md. MEMORY.md auto-loads at session start, so a new session restores context immediately.

### Plan File Persistence

- Record plan file path and purpose in MEMORY.md immediately after creation
- Archive completed plans to `docs/plans/`

### Session Resilience Principles

- **Images are toxic** → Never read images in main context; delegate to subagents
- **Exploration is delegated** → Return only summaries to main context
- **Persistence is dual** → Write to both report file + MEMORY.md
- **Plans are recorded** → Write path to MEMORY.md the moment a plan is created

---

## 5. Information Resolution Protocol

### Two Failure Modes to Eliminate

| Failure Mode | Pattern | Consequence |
|---|---|---|
| **Type A: Premature delegation** | Ask user for info that a configured tool can fetch | User burden; violates Zero User Burden Principle |
| **Type B: Silent assumption** | Guess inaccessible content without asking | Hallucination; corrupts plan and implementation with undetectable errors |

### Decision Tree

IF a task references any external resource (URL, issue number, document, Slack message, Notion page, etc.)
THEN execute the following steps for EACH referenced resource individually:

**Step 1: Identify available tools**

"Available" means: the tool appears in the current active tools list for this session.

| Resource Type | Tool to Use First |
|---|---|
| Slack URL / message | Slack MCP |
| Notion URL / page | Notion MCP (`notion_retrieve_page`, `notion_search`) |
| GitHub issue / PR / comment | GitHub MCP (`mcp__github__get_issue`, `mcp__github__get_pull_request`) or `gh` CLI |
| Google Doc / Sheet | gdrive MCP (`gdrive_read_file`, `gsheets_read`) |
| Figma URL | Figma MCP (`figma_get_file`, `figma_get_file_nodes`) |
| Any public URL | WebFetch first, then Tavily |
| Local file / path | Read, Grep, Glob |
| Linear / Jira ticket | WebFetch the URL if no dedicated MCP; otherwise use dedicated MCP |

**Step 2: Attempt retrieval — mandatory**

IF a tool from Step 1 is available THEN attempt retrieval before any other action.
NEVER ask the user before making the attempt.
NEVER skip this step due to assumed failure.

**Step 3: On success — use the content**

Use the retrieved content directly.
Do not report the retrieval attempt to the user unless it is directly relevant to the response.

**Step 4: On failure — ask immediately**

IF retrieval fails (error response, 401/403/404, timeout, tool not available) THEN:
- Call `AskUserQuestion` immediately.
- State which URL/reference was attempted.
- Request the content directly (not "do you have it?").
- Ask only for the specific information that failed.

Example: `"このNotionページ（{url}）にアクセスできませんでした。該当ページの内容をコピペしてもらえますか？"`

### Prohibition: Silent Assumption

NEVER guess, infer, or assume the content of an external resource
WHEN the resource is referenced and retrieval fails or no tool is available
BECAUSE assumptions about external content produce plans and code built on hallucinated facts.

**Violation pattern**: "Based on a typical Slack thread structure, I'll assume this task means X."
**Required behavior**: Call `AskUserQuestion` referencing the specific URL or resource identifier.
**Exception**: The user explicitly provides the content in the same message (no retrieval needed).

**Confidence**: High

### Prohibition: Premature User Delegation

NEVER ask the user to provide information
WHEN a tool available in the current session can retrieve that information
BECAUSE attempting retrieval first is mandatory under the Zero User Burden Principle (see core.md §6).

**Violation pattern**: "Could you paste the GitHub issue description?" (when GitHub MCP is in the tools list)
**Required behavior**: Call the appropriate MCP tool first. Ask only if the call returns an error.
**Exception**: The user volunteers the content proactively; accept it and proceed.

**Confidence**: High

### Special Rule: Plan Mode / EnterPlanMode

IF operating in plan mode (via `/plan`, `EnterPlanMode`, or any planning workflow phase)
AND a referenced external resource cannot be retrieved
THEN:

1. Call `AskUserQuestion` with the specific missing resource before writing the plan file.
2. Do NOT write any plan section whose content depends on the unverified resource.
3. Every claim about external resource content in the plan must reference retrieved content, not inference.

BECAUSE a plan built on assumed information produces an incorrect implementation target and wastes the entire execution phase.

**Confidence**: High
