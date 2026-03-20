# Pre-Mortem Analysis: FigDiff Public Release

Date: 2026-03-20

## Premise

"If this project failed after going public, what would be the cause?"

## Risk Matrix

| Rank | Risk | Impact | Probability |
|------|------|--------|-------------|
| 1 | Complex setup causes first-time user dropout | Critical | High |
| 2 | UNLICENSED blocks external contributions | High | High |
| 3 | Unsigned Electron app blocked by OS gatekeeper | High | High |
| 4 | Narrow target audience limits adoption | Critical | Medium |
| 5 | Full Figma API dependency — single point of failure | Critical | Low-Medium |
| 6 | Node.js 25.x (non-LTS) causes environment friction | Medium | Medium |
| 7 | Monorepo maintenance burden leads to burnout | High | Medium |
| 8 | Symmetric git-crypt key management is fragile | Medium | Low |

## Detailed Analysis

### 1. Complex Setup — First-Time User Dropout (Critical / High)

Current onboarding requires: Figma PAT, git-crypt key sharing, mise for Node.js 25.x, Electron + electron-vite build. Each step is a potential dropout point. The #1 cause of OSS project failure is "followed the README but it didn't work."

**Mitigation**: Provide a hosted/web version or a single-binary download. Minimize setup to 2 steps max.

### 2. UNLICENSED — Contribution Barrier (High / High)

OSS contributors do not contribute to projects without a clear license. The current `UNLICENSED` status means zero external contributions indefinitely.

**Mitigation**: Decide on MIT or Apache-2.0 early. Add CONTRIBUTING.md.

### 3. Unsigned Electron App (High / High)

macOS Gatekeeper blocks unsigned apps. Windows SmartScreen warns about unsigned executables. Without code signing ($99/year Apple Developer Program + Windows signing cert), distribution is effectively broken.

**Mitigation**: Set up code signing in CI. Consider web-first approach to avoid signing entirely.

### 4. Narrow Target Audience (Critical / Medium)

"Pixel-diff between Figma and implementation" targets a niche: people who care about both design fidelity AND have access to both Figma and the codebase. Competitors (Chromatic, Percy, Storybook Visual Tests) already exist in the visual regression space.

**Mitigation**: Clearly articulate differentiation (AI-driven iterative fix loop). Target design-system teams specifically.

### 5. Figma API Dependency (Critical / Low-Medium)

Core flow depends entirely on Figma's REST API. Rate limit changes, API deprecation, or pricing changes could break the product overnight with no fallback.

**Mitigation**: Abstract the design source behind an adapter interface. Support Figma export files as offline fallback.

### 6. Node.js 25.x Non-LTS (Medium / Medium)

Node.js 25 is Current, not LTS until October 2026. Contributors may not have it installed. CI environments may not support it. This creates unnecessary friction.

**Mitigation**: Consider downgrading to Node.js 22 LTS until 25 reaches LTS status.

### 7. Monorepo Maintenance Burden (High / Medium)

5 packages (desktop, mcp-server, figma-plugin, chrome-extension, shared) is heavy for a solo maintainer. Dependency updates, CI maintenance, and cross-package consistency require ongoing effort.

**Mitigation**: Prioritize 1-2 core packages. Archive or mark others as experimental.

### 8. Git-Crypt Key Management (Medium / Low)

Symmetric key at `~/.figdiff/git-crypt-key` has no defined sharing protocol for contributors. If the key leaks, all encrypted files are compromised with no rotation mechanism.

**Mitigation**: Migrate to GPG-based git-crypt. Define key distribution protocol in CONTRIBUTING.md.

## Recommended Priority Actions

1. **Choose a license** (MIT/Apache-2.0) — removes contribution barrier immediately
2. **Simplify setup** — Docker-based dev environment or web-first approach
3. **Set up code signing** — required before any real distribution
4. **Downgrade to Node.js 22 LTS** — reduces friction for contributors
5. **Write CONTRIBUTING.md** — defines git-crypt key sharing, dev setup, PR process
