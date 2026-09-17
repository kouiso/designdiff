import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, statfs, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { _electron as electron, expect } from "playwright/test";
import sharp from "sharp";

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, "../../..");
const require = createRequire(import.meta.url);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const collectFiles = async (root) => {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(path)));
    else files.push(path);
  }
  return files;
};
const buildRoots = [
  join(repository, "app/desktop/dist"),
  join(repository, "package/shared/dist"),
  join(repository, "package/credential-store/dist"),
];
const buildIdentityFiles = [
  join(repository, "pnpm-lock.yaml"),
  join(repository, "package.json"),
  join(repository, "app/desktop/package.json"),
  join(repository, "package/shared/package.json"),
  join(repository, "package/credential-store/package.json"),
];
const captureBuild = async () => {
  const paths = [
    ...(await Promise.all(buildRoots.map(collectFiles))).flat(),
    ...buildIdentityFiles,
  ].sort();
  const files = await Promise.all(
    paths.map(async (path) => ({
      path: path.slice(repository.length + 1),
      size: (await stat(path)).size,
      sha256: sha256(await readFile(path)),
    })),
  );
  return {
    roots: buildRoots.map((path) => path.slice(repository.length + 1)),
    identityFiles: buildIdentityFiles.map((path) => path.slice(repository.length + 1)),
    fileCount: files.length,
    sha256: sha256(
      Buffer.from(files.map((file) => `${file.path}\0${file.size}\0${file.sha256}`).join("\n")),
    ),
    files,
  };
};

const evidencePath = process.env.FIGDIFF_ISSUE_REPORT_EVIDENCE;
if (!evidencePath) throw new Error("FIGDIFF_ISSUE_REPORT_EVIDENCE is required");
const evidence = resolve(evidencePath);
await mkdir(evidence, { recursive: true });
const filesystem = await statfs(evidence);
if (filesystem.bavail * filesystem.bsize < 512 * 1024 * 1024) {
  throw new Error("Native verification requires at least 512 MiB free before launch");
}
const startedAt = new Date().toISOString();
const buildAtStart = await captureBuild();
const revision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repository,
  encoding: "utf8",
}).trim();
const dirtyState = execFileSync("git", ["status", "--porcelain=v1"], {
  cwd: repository,
  encoding: "utf8",
})
  .trimEnd()
  .split("\n")
  .filter(Boolean);

const fixture = {
  repository: { owner: "kouiso", repo: "designdiff" },
  input: {
    title: "Artificial token ghp_nativeFixture123",
    body: "Artificial path /home/fixture/private/reproduction.txt",
    category: "bug",
  },
  expectedPreview: {
    title: "[bug] Artificial token [REDACTED]",
    body: "Artificial path ~/private/reproduction.txt",
    labels: ["desktop-feedback", "bug"],
    maskedCount: 2,
  },
};
await writeFile(join(evidence, "fixture-input.json"), `${JSON.stringify(fixture, null, 2)}\n`);

const createSandbox = async (name) => {
  const sandbox = await mkdtemp(join(evidence, `native-issue-${name}-`));
  const isolatedHome = join(sandbox, "home");
  const userData = join(sandbox, "user-data");
  const projectDirectory = join(isolatedHome, ".figdiff/projects/issue-report-fixture");
  await Promise.all([
    mkdir(projectDirectory, { recursive: true }),
    mkdir(userData, { recursive: true }),
  ]);
  const designPath = join(isolatedHome, "design.png");
  await sharp({ create: { width: 20, height: 20, channels: 4, background: "#3367d6" } })
    .png()
    .toFile(designPath);
  await writeFile(
    join(projectDirectory, "project.json"),
    JSON.stringify({
      id: "issue-report-fixture",
      name: "Issue report fixture",
      implementationUrl: "http://localhost:3000",
      pages: [
        {
          id: "fixture-page",
          name: "Fixture page",
          path: "/",
          designSources: [
            {
              id: "fixture-image",
              type: "local_image",
              label: "Fixture design",
              filePath: designPath,
            },
          ],
        },
      ],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    }),
  );
  return { sandbox, isolatedHome, userData };
};

const createBootstrap = async ({ sandbox, isolatedHome, userData }, mode) => {
  const ipcLog = join(evidence, `${mode}-ipc.jsonl`);
  const githubLog = join(evidence, `${mode}-github-read-mock.jsonl`);
  const bootstrap = join(sandbox, "bootstrap.mjs");
  await writeFile(
    bootstrap,
    `
import os from "node:os";
import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { app, ipcMain } from "electron";
os.homedir = () => ${JSON.stringify(isolatedHome)};
syncBuiltinESMExports();
app.setPath("home", ${JSON.stringify(isolatedHome)});
app.setPath("userData", ${JSON.stringify(userData)});
const ipcLog = ${JSON.stringify(ipcLog)};
const githubLog = ${JSON.stringify(githubLog)};
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => originalHandle(channel, async (event, ...args) => {
  if (!channel.startsWith("issue-report:")) return handler(event, ...args);
  appendFileSync(ipcLog, JSON.stringify({ phase: "request", channel, args }) + "\\n");
  try {
    const result = await handler(event, ...args);
    appendFileSync(ipcLog, JSON.stringify({ phase: "response", channel, result }) + "\\n");
    return result;
  } catch (error) {
    appendFileSync(ipcLog, JSON.stringify({ phase: "error", channel, error: String(error) }) + "\\n");
    throw error;
  }
});
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  const method = init.method ?? (typeof input === "string" ? "GET" : input.method);
  appendFileSync(githubLog, JSON.stringify({ method, url }) + "\\n");
  if (method !== "GET" || !url.startsWith("https://api.github.com/search/issues?")) {
    throw new Error("Native issue verification forbids GitHub writes and unexpected network access");
  }
  return new Response(JSON.stringify({ items: [] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
const credentials = await import(${JSON.stringify(pathToFileURL(join(repository, "package/credential-store/dist/index.js")).href)});
credentials.selectFileCredentialBackend();
await import(${JSON.stringify(pathToFileURL(join(repository, "app/desktop/dist/main/main.js")).href)});
`,
  );
  return { bootstrap, ipcLog, githubLog };
};

const readJsonLines = async (path) => {
  try {
    const text = await readFile(path, "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
};

const pageErrors = [];
const rendererCrashes = [];
const sandboxes = [];
let currentApplication;
let currentPage;

const launch = async (mode, token) => {
  const sandbox = await createSandbox(mode);
  sandboxes.push(sandbox.sandbox);
  const logs = await createBootstrap(sandbox, mode);
  const emptyPath = join(sandbox.sandbox, "empty-path");
  await mkdir(emptyPath);
  const environment = {
    ...process.env,
    PATH: emptyPath,
    GITHUB_TOKEN: token,
    FIGDIFF_ISSUE_REPO: `${fixture.repository.owner}/${fixture.repository.repo}`,
    FIGDIFF_PROJECT_ROOT: join(sandbox.sandbox, "no-project-root"),
    FIGDIFF_HOME: join(sandbox.isolatedHome, ".figdiff"),
    FIGDIFF_DISABLE_KEYCHAIN_READ: "1",
  };
  delete environment.GH_TOKEN;
  delete environment.ELECTRON_RUN_AS_NODE;
  const application = await electron.launch({
    executablePath: process.env.FIGDIFF_ELECTRON_EXECUTABLE ?? require("electron"),
    args: [logs.bootstrap, `--user-data-dir=${sandbox.userData}`],
    env: environment,
    timeout: 30_000,
  });
  const page = await application.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(`${mode}: ${error.message}`));
  page.on("crash", () => rendererCrashes.push(`${mode}: renderer crashed`));
  return { application, page, logs };
};

const openIssueDialog = async (page) => {
  await expect(page.getByText("Issue report fixture", { exact: true }).first()).toBeVisible();
  await page.getByText("Issue report fixture", { exact: true }).first().click();
  await expect(page.getByText("Fixture design", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "比較を開始", exact: true }).click();
  await expect(page.getByText("デザインと実装を比較", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "問題を報告", exact: true }).click();
  await expect(page.getByRole("heading", { name: "問題を報告", exact: true })).toBeVisible();
};

const fillFixture = async (page) => {
  await page.getByLabel("種類").selectOption(fixture.input.category);
  await page.getByLabel("タイトル").fill(fixture.input.title);
  await page.getByLabel("内容").fill(fixture.input.body);
};

try {
  const valid = await launch("valid", "ghp_artificialNativeCredential123");
  currentApplication = valid.application;
  currentPage = valid.page;
  const preloadSurface = await valid.page.evaluate(() => ({
    prepare: typeof window.electronAPI?.issueReport?.prepare,
    submit: typeof window.electronAPI?.issueReport?.submit,
    discard: typeof window.electronAPI?.issueReport?.discard,
  }));
  assert.deepEqual(preloadSurface, {
    prepare: "function",
    submit: "function",
    discard: "function",
  });
  await openIssueDialog(valid.page);
  await fillFixture(valid.page);
  await valid.page.getByRole("button", { name: "送信内容を確認", exact: true }).click();
  await expect(
    valid.page.getByRole("heading", { name: fixture.expectedPreview.title }),
  ).toBeVisible();
  await expect(valid.page.getByText(fixture.expectedPreview.body, { exact: true })).toBeVisible();
  await expect(valid.page.getByText("kouiso/designdiff", { exact: true })).toBeVisible();
  await expect(
    valid.page.getByText("ラベル: desktop-feedback, bug", { exact: true }),
  ).toBeVisible();
  await expect(valid.page.getByText("秘匿処理: 2件", { exact: true })).toBeVisible();
  await expect(valid.page.getByLabel("タイトル")).toHaveCount(0);
  await expect(
    valid.page.getByRole("button", { name: "この内容を送信", exact: true }),
  ).toBeVisible();
  await valid.page.screenshot({
    path: join(evidence, "reviewed-readonly-draft.png"),
    animations: "disabled",
  });

  await valid.page.getByRole("button", { name: "編集に戻る", exact: true }).click();
  await expect(valid.page.getByLabel("タイトル")).toHaveValue(fixture.input.title);
  await expect(valid.page.getByLabel("内容")).toHaveValue(fixture.input.body);
  await valid.page.getByRole("button", { name: "送信内容を確認", exact: true }).click();
  await expect(
    valid.page.getByRole("heading", { name: fixture.expectedPreview.title }),
  ).toBeVisible();
  await valid.page.getByRole("button", { name: "閉じる", exact: true }).click();
  await expect(valid.page.getByRole("heading", { name: "問題を報告", exact: true })).toHaveCount(0);
  await valid.application.close();
  currentApplication = undefined;
  currentPage = undefined;

  const validIpc = await readJsonLines(valid.logs.ipcLog);
  const validGithub = await readJsonLines(valid.logs.githubLog);
  const prepareRequests = validIpc.filter(
    (entry) => entry.phase === "request" && entry.channel === "issue-report:prepare",
  );
  const prepareResponses = validIpc.filter(
    (entry) => entry.phase === "response" && entry.channel === "issue-report:prepare",
  );
  const discardRequests = validIpc.filter(
    (entry) => entry.phase === "request" && entry.channel === "issue-report:discard",
  );
  const submitRequests = validIpc.filter(
    (entry) => entry.phase === "request" && entry.channel === "issue-report:submit",
  );
  assert.equal(prepareRequests.length, 2);
  assert.ok(
    prepareRequests.every(
      (entry) => JSON.stringify(entry.args[0]) === JSON.stringify(fixture.input),
    ),
  );
  assert.equal(prepareResponses.length, 2);
  const draftIds = prepareResponses.map((entry) => entry.result.draftId);
  assert.equal(new Set(draftIds).size, 2);
  assert.ok(
    prepareResponses.every(
      (entry) =>
        entry.result.title === fixture.expectedPreview.title &&
        entry.result.body === fixture.expectedPreview.body &&
        JSON.stringify(entry.result.labels) === JSON.stringify(fixture.expectedPreview.labels) &&
        entry.result.maskedCount === fixture.expectedPreview.maskedCount &&
        entry.result.duplicate.status === "none",
    ),
  );
  assert.deepEqual(
    discardRequests.map((entry) => entry.args),
    draftIds.map((draftId) => [draftId]),
  );
  assert.deepEqual(submitRequests, []);
  assert.equal(validGithub.length, 2);
  assert.ok(
    validGithub.every(
      (entry) =>
        entry.method === "GET" && entry.url.startsWith("https://api.github.com/search/issues?"),
    ),
  );

  const invalid = await launch("invalid-credential", " ");
  currentApplication = invalid.application;
  currentPage = invalid.page;
  await openIssueDialog(invalid.page);
  await fillFixture(invalid.page);
  await invalid.page.getByRole("button", { name: "送信内容を確認", exact: true }).click();
  await expect(invalid.page.getByRole("alert")).toContainText(
    "GITHUB_TOKEN に不正な文字が含まれています。",
  );
  await invalid.page.screenshot({
    path: join(evidence, "credential-failure-visible.png"),
    animations: "disabled",
  });
  await invalid.application.close();
  currentApplication = undefined;
  currentPage = undefined;

  const invalidIpc = await readJsonLines(invalid.logs.ipcLog);
  const invalidGithub = await readJsonLines(invalid.logs.githubLog);
  assert.equal(invalidIpc.filter((entry) => entry.channel === "issue-report:prepare").length, 2);
  assert.ok(
    invalidIpc.some(
      (entry) =>
        entry.phase === "error" &&
        entry.channel === "issue-report:prepare" &&
        entry.error.includes("GITHUB_TOKEN に不正な文字"),
    ),
  );
  assert.deepEqual(invalidGithub, []);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(rendererCrashes, []);

  const resultPath = join(evidence, "native-issue-report.json");
  await writeFile(
    resultPath,
    `${JSON.stringify(
      {
        execution: { status: "passed", exitCode: 0 },
        fixture: { artificial: true, input: fixture },
        observed: {
          preloadSurface,
          valid: {
            prepareRequestCount: prepareRequests.length,
            preparedDraftIds: draftIds,
            discardedDraftIds: discardRequests.map((entry) => entry.args[0]),
            submitRequestCount: submitRequests.length,
            githubReadMockRequests: validGithub,
          },
          invalidCredential: {
            ipc: invalidIpc,
            githubReadMockRequests: invalidGithub,
          },
        },
        boundaries: {
          real: [
            "Electron main",
            "contextBridge preload",
            "IPC handlers",
            "draft service",
            "renderer UI",
          ],
          mocked: [
            "GitHub search GET only; returns an explicit empty issue list and records every request",
          ],
          forbidden: ["GitHub POST", "live GitHub credentials", "non-fixture report input"],
        },
        pageErrors,
        rendererCrashes,
      },
      null,
      2,
    )}\n`,
  );

  const buildAtEnd = await captureBuild();
  const buildUnchanged = buildAtEnd.sha256 === buildAtStart.sha256;
  const artifactPaths = (await readdir(evidence, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name !== "manifest.json")
    .map((entry) => join(evidence, entry.name))
    .sort();
  const artifacts = await Promise.all(
    artifactPaths.map(async (path) => ({
      path: basename(path),
      size: (await stat(path)).size,
      sha256: sha256(await readFile(path)),
    })),
  );
  await writeFile(
    join(evidence, "manifest.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        startedAt,
        completedAt: new Date().toISOString(),
        revision,
        dirtyState,
        command:
          "FIGDIFF_ISSUE_REPORT_EVIDENCE=<evidence> xvfb-run -a node app/desktop/e2e/native-issue-report.mjs",
        build: buildAtStart,
        buildEndSha256: buildAtEnd.sha256,
        buildUnchanged,
        driver: {
          path: "app/desktop/e2e/native-issue-report.mjs",
          sha256: sha256(await readFile(fileURLToPath(import.meta.url))),
        },
        scope:
          "Synthetic native Electron issue-report prepare/review/edit/discard and credential-failure flow. GitHub search is a recorded GET-only mock; submission is forbidden and untested.",
        artifacts,
      },
      null,
      2,
    )}\n`,
  );
  assert.ok(buildUnchanged, "desktop/shared build changed during native verification");
} catch (error) {
  if (currentPage) {
    await currentPage.screenshot({ path: join(evidence, "failure.png"), animations: "disabled" });
    await writeFile(
      join(evidence, "failure-dom.txt"),
      await currentPage.locator("body").innerText(),
    );
  }
  throw error;
} finally {
  try {
    await currentApplication?.close();
  } finally {
    await Promise.all(sandboxes.map((sandbox) => rm(sandbox, { recursive: true, force: true })));
  }
}
