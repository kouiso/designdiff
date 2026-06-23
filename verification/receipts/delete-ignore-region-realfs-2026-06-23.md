# deleteIgnoreRegion real-filesystem E2E receipt (PR #202)

Verdict: **GUARD-CONFIRMED**

Branch under verification: `fix/197-delete-ignore-region-existsguard`

## Commands and observed output

### `npm ci`

Command:

```bash
npm ci 2>&1 | tee /tmp/designdiff-npm-ci.log
```

Observed output:

```text
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.
npm error code EUSAGE
npm error
npm error The `npm ci` command can only install with an existing package-lock.json or
npm error npm-shrinkwrap.json with lockfileVersion >= 1. Run an install with npm@5 or
npm error later to generate a package-lock.json file, then try again.
npm error
npm error Clean install a project
npm error
npm error Usage:
npm error npm ci
npm error
npm error Options:
npm error [--install-strategy <hoisted|nested|shallow|linked>] [--legacy-bundling]
npm error [--global-style] [--omit <dev|optional|peer> [--omit <dev|optional|peer> ...]]
npm error [--include <prod|dev|optional|peer> [--include <prod|dev|optional|peer> ...]]
npm error [--strict-peer-deps] [--foreground-scripts] [--ignore-scripts] [--no-audit]
npm error [--no-bin-links] [--no-fund] [--dry-run]
npm error [-w|--workspace <workspace-name> [-w|--workspace <workspace-name> ...]]
npm error [--workspaces] [--include-workspace-root] [--install-links]
npm error
npm error aliases: clean-install, ic, install-clean, isntall-clean
npm error
npm error Run "npm help ci" for more info
npm error A complete log of this run can be found in: /root/.npm/_logs/2026-06-23T03_36_37_404Z-debug-0.log
```

Note: this repository documents pnpm (`packageManager: pnpm@9.15.0`) and has `pnpm-lock.yaml`, not `package-lock.json`; the documented pnpm install/build path was used for the executable receipt below.

### Build `app/mcp-server`

Command:

```bash
pnpm install 2>&1 | tee /tmp/designdiff-pnpm-install.log
pnpm --filter @figdiff/mcp-server build 2>&1 | tee /tmp/designdiff-mcp-build.log
```

Observed output:

```text
 WARN  Unsupported engine: wanted: {"node":">=25.6.1"} (current: {"node":"v20.20.2","pnpm":"9.15.0"})
Scope: all 8 workspace projects
Lockfile is up to date, resolution step is skipped
Already up to date

Done in 2.9s
.                                        |  WARN  Unsupported engine: wanted: {"node":">=25.6.1"} (current: {"node":"v20.20.2","pnpm":"9.15.0"})

> @figdiff/mcp-server@0.1.0 prebuild /workspace/designdiff/app/mcp-server
> pnpm --filter @figdiff/credential-store build

../..                                    |  WARN  Unsupported engine: wanted: {"node":">=25.6.1"} (current: {"node":"v20.20.2","pnpm":"9.15.0"})

> @figdiff/credential-store@0.1.0 build /workspace/designdiff/package/credential-store
> tsc


> @figdiff/mcp-server@0.1.0 build /workspace/designdiff/app/mcp-server
> tsc -b --force && node -e "require('node:fs').chmodSync('dist/index.js', 0o755)"
```

### Real-filesystem behavioral receipt

Command:

```bash
cat > /tmp/delete-ignore-region-realfs-receipt.mjs <<'SCRIPT'
import { mkdir, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { deleteIgnoreRegion, setIgnoreRegionConfig, getIgnoreRegionPath } from '/workspace/designdiff/app/mcp-server/dist/service/ignore-region-store.js';
import { getProjectsDirPath } from '/workspace/designdiff/app/mcp-server/dist/service/project-store.js';
import { registerCreateProject } from '/workspace/designdiff/app/mcp-server/dist/tool/create-project.js';

const projectsBase = getProjectsDirPath();
const ghostProjectId = 'ghost-nonexistent-001';
const happyProjectId = `receipt-happy-${Date.now()}`;

async function lsProjects() {
  await mkdir(projectsBase, { recursive: true });
  const { readdir } = await import('node:fs/promises');
  const names = await readdir(projectsBase);
  return names.sort();
}

async function createProjectViaTool(projectId) {
  let handler;
  const fakeServer = {
    registerTool(_name, _definition, cb) {
      handler = cb;
    },
  };
  registerCreateProject(fakeServer);
  const result = await handler({
    id: projectId,
    name: 'deleteIgnoreRegion realfs receipt',
    implementation_url: 'https://example.com',
  });
  if (result.isError) {
    throw new Error(`create_project failed: ${JSON.stringify(result)}`);
  }
  return JSON.parse(result.content[0].text);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

console.log(`HOME=${homedir()}`);
console.log(`projectsBase=${projectsBase}`);
console.log(`ghostIgnoreRegionPath=${getIgnoreRegionPath(ghostProjectId)}`);
await rm(join(projectsBase, ghostProjectId), { recursive: true, force: true });
console.log(`ghostBeforeLs=${JSON.stringify(await lsProjects())}`);
const ghostResult = await deleteIgnoreRegion(ghostProjectId, 'r1');
console.log(`ghostReturn=${JSON.stringify(ghostResult)}`);
console.log(`ghostAfterLs=${JSON.stringify(await lsProjects())}`);
console.log(`ghostDirExistsAfter=${existsSync(join(projectsBase, ghostProjectId))}`);
assert(JSON.stringify(ghostResult) === JSON.stringify({ version: 1, regions: [] }), 'ghost return was not empty config');
assert(!existsSync(join(projectsBase, ghostProjectId)), 'ghost project directory was fabricated');
console.log('ghostAssertions=PASS');

await rm(join(projectsBase, happyProjectId), { recursive: true, force: true });
const created = await createProjectViaTool(happyProjectId);
console.log(`createProjectReturn=${JSON.stringify(created)}`);
const setResult = await setIgnoreRegionConfig(happyProjectId, [
  { id: 'r1', x: 10, y: 20, width: 30, height: 40, label: 'remove me' },
  { id: 'r2', x: 50, y: 60, width: 70, height: 80, label: 'keep me' },
]);
console.log(`setReturn=${JSON.stringify(setResult)}`);
console.log(`yamlBeforeDelete=\n${await readFile(getIgnoreRegionPath(happyProjectId), 'utf-8')}`);
const deleteResult = await deleteIgnoreRegion(happyProjectId, 'r1');
console.log(`deleteReturn=${JSON.stringify(deleteResult)}`);
const yamlAfterDelete = await readFile(getIgnoreRegionPath(happyProjectId), 'utf-8');
console.log(`yamlAfterDelete=\n${yamlAfterDelete}`);
assert(deleteResult.regions.length === 1, 'delete result should contain one region');
assert(deleteResult.regions[0].id === 'r2', 'delete result did not keep r2');
assert(!yamlAfterDelete.includes('id: r1'), 'persisted yaml still contains r1');
assert(yamlAfterDelete.includes('id: r2'), 'persisted yaml does not contain r2');
console.log('happyAssertions=PASS');
console.log('verdict=GUARD-CONFIRMED');
SCRIPT
node /tmp/delete-ignore-region-realfs-receipt.mjs 2>&1 | tee /tmp/delete-ignore-region-realfs-receipt.log
```

Observed output:

```text
HOME=/root
projectsBase=/root/.figdiff/projects
ghostIgnoreRegionPath=/root/.figdiff/projects/ghost-nonexistent-001/ignore-regions.yaml
ghostBeforeLs=[]
ghostReturn={"version":1,"regions":[]}
ghostAfterLs=[]
ghostDirExistsAfter=false
ghostAssertions=PASS
createProjectReturn={"project_id":"receipt-happy-1782185837420","name":"deleteIgnoreRegion realfs receipt","implementationUrl":"https://example.com"}
setReturn={"version":1,"regions":[{"x":10,"y":20,"width":30,"height":40,"label":"remove me","id":"r1"},{"x":50,"y":60,"width":70,"height":80,"label":"keep me","id":"r2"}]}
yamlBeforeDelete=
version: 1
regions:
  - x: 10
    y: 20
    width: 30
    height: 40
    label: remove me
    id: r1
  - x: 50
    y: 60
    width: 70
    height: 80
    label: keep me
    id: r2

deleteReturn={"version":1,"regions":[{"x":50,"y":60,"width":70,"height":80,"label":"keep me","id":"r2"}]}
yamlAfterDelete=
version: 1
regions:
  - x: 50
    y: 60
    width: 70
    height: 80
    label: keep me
    id: r2

happyAssertions=PASS
verdict=GUARD-CONFIRMED
```
