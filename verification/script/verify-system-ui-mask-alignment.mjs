import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isDeepStrictEqual } from "node:util";

import sharp from "sharp";

import { runWithExclusiveProcessLock } from "./exclusive-process-lock.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const TASK_LOCK_NAME = "issue-1579-system-ui-mask-alignment-evidence";
const FIXTURE_DIR = path.join(ROOT, "verification/fixture/pair-06-system-ui-alignment");
const EVIDENCE_DIR = path.join(ROOT, "verification/receipt/issue-1579-system-ui-mask");
const EXPECTED_FILENAME = "expected.json";
const DESIGN_FILENAME = "figma-export.png";
const SCREENSHOT_FILENAME = "impl-stitched-system-ui.png";
const WIDTH = 1080;
const VIEWPORT_HEIGHT = 2400;
const STITCHED_HEIGHT = 4800;
const STATUS_BAR_HEIGHT = 72;
const NAVIGATION_BAR_HEIGHT = 72;
const RUN_COUNT = 3;
const EVIDENCE_IMAGE_FILENAMES = [
  "aligned-design.png",
  "comparison-sheet.png",
  "diff-run-1.png",
  "diff-run-2.png",
  "diff-run-3.png",
  "figma-export.png",
  "residual-run-1.png",
  "residual-run-2.png",
  "residual-run-3.png",
  "stitched-capture.png",
];
const IMPORTED_DIST_MODULE_FILES = [
  "app/mcp-server/dist/service/image-compare-service.js",
  "app/mcp-server/dist/service/diff-report-builder.js",
  "package/shared/dist/confidence/system-bar-ignore-regions.js",
  "package/shared/dist/index.js",
  "package/shared/dist/signal/delta-e-2000.js",
  "package/shared/dist/signal/flat-region-color.js",
  "package/shared/dist/signal/hausdorff.js",
  "package/shared/dist/signal/ssim.js",
  "package/shared/dist/signal/translation.js",
  "package/shared/dist/verification-fixture.js",
];
const RUNTIME_BUILD_OUTPUT_DIRS = ["app/mcp-server/dist", "package/shared/dist"];
const RUNTIME_BUILD_COMMANDS = [
  ["pnpm", ["--filter", "@figdiff/shared", "build"]],
  ["pnpm", ["--filter", "@figdiff/mcp-server", "build"]],
];
const GENERATED_ARTIFACT_ROOTS = [
  "verification/fixture/pair-06-system-ui-alignment",
  "verification/receipt/issue-1579-system-ui-mask",
];
const CARD_COLORS = [
  [225, 239, 255],
  [232, 247, 237],
  [255, 240, 225],
  [244, 233, 255],
];
const HEADER_COLOR = [34, 67, 108];
const TEXT_COLOR = [43, 55, 69];
const ACCENT_COLOR = [40, 111, 184];
const SURFACE_COLOR = [247, 249, 252];
const WHITE = [255, 255, 255];

function runGit(args) {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
}

function runGitBuffer(args) {
  return execFileSync("git", args, {
    cwd: ROOT,
    maxBuffer: 128 * 1024 * 1024,
  });
}

function normalizeRepositoryPath(filename) {
  return filename.split(path.sep).join("/");
}

function isInsideRoot(filename, root) {
  return filename === root || filename.startsWith(`${root}/`);
}

function parsePorcelainStatus(statusBuffer) {
  const tokens = statusBuffer.toString("utf8").split("\0");
  const entries = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    const status = token.slice(0, 2);
    const filename = normalizeRepositoryPath(token.slice(3));
    const entry = { status, filename };
    if (status.includes("R") || status.includes("C")) {
      const originalFilename = tokens[index + 1];
      if (!originalFilename) {
        throw new Error(`malformed git status rename entry: ${filename}`);
      }
      entry.originalFilename = normalizeRepositoryPath(originalFilename);
      index += 1;
    }
    entries.push(entry);
  }
  return entries;
}

async function hashWorkingTreeEntry(filename) {
  const absolutePath = path.join(ROOT, filename);
  try {
    const stat = await fs.lstat(absolutePath);
    const hash = createHash("sha256");
    if (stat.isSymbolicLink()) {
      hash.update("symlink\0");
      hash.update(await fs.readlink(absolutePath));
    } else {
      hash.update("file\0");
      hash.update(await fs.readFile(absolutePath));
    }
    return hash.digest("hex");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function buildExcludedPathspecs(excludedRoots) {
  return excludedRoots.map((root) => `:(exclude)${root}/**`);
}

async function readGitChangeSet(excludedRoots, includedRoots = []) {
  const statusBuffer = runGitBuffer(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const allEntries = parsePorcelainStatus(statusBuffer);
  const entries = allEntries.filter((entry) => {
    const paths = [entry.filename, entry.originalFilename].filter(Boolean);
    const isIncluded =
      includedRoots.length === 0 ||
      paths.some((filename) => includedRoots.some((root) => isInsideRoot(filename, root)));
    const isExcluded = paths.every((filename) =>
      excludedRoots.some((root) => isInsideRoot(filename, root)),
    );
    return isIncluded && !isExcluded;
  });
  const pathspecs =
    includedRoots.length === 0
      ? ["--", ".", ...buildExcludedPathspecs(excludedRoots)]
      : ["--", ...includedRoots];
  const [indexDiff, worktreeDiff, headDiff] = [
    runGitBuffer(["diff", "--cached", "--binary", "--no-ext-diff", ...pathspecs]),
    runGitBuffer(["diff", "--binary", "--no-ext-diff", ...pathspecs]),
    runGitBuffer(["diff", "HEAD", "--binary", "--no-ext-diff", ...pathspecs]),
  ];
  const entriesWithContent = await Promise.all(
    entries.map(async (entry) => ({
      ...entry,
      workingTreeSha256: await hashWorkingTreeEntry(entry.filename),
    })),
  );
  const indexDiffSha256 = createHash("sha256").update(indexDiff).digest("hex");
  const worktreeDiffSha256 = createHash("sha256").update(worktreeDiff).digest("hex");
  const headDiffSha256 = createHash("sha256").update(headDiff).digest("hex");
  const bundleHash = createHash("sha256");
  bundleHash.update(JSON.stringify(entriesWithContent));
  bundleHash.update(indexDiff);
  bundleHash.update(worktreeDiff);
  bundleHash.update(headDiff);
  return {
    bundleSha256: bundleHash.digest("hex"),
    changedFileCount: entriesWithContent.length,
    clean:
      entriesWithContent.length === 0 &&
      indexDiff.length === 0 &&
      worktreeDiff.length === 0 &&
      headDiff.length === 0,
    entries: entriesWithContent,
    indexDiffSha256,
    worktreeDiffSha256,
    headDiffSha256,
  };
}

async function readTrackedSourceFingerprint(excludedRoots) {
  const trackedFiles = runGitBuffer(["ls-files", "-z"])
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map(normalizeRepositoryPath)
    .filter((filename) => !excludedRoots.some((root) => isInsideRoot(filename, root)))
    .sort();
  return hashFiles(ROOT, trackedFiles);
}

async function readRepositoryState(phase, additionalGeneratedDirectories = []) {
  const excludedRoots = [
    ...GENERATED_ARTIFACT_ROOTS,
    ...additionalGeneratedDirectories.map((directory) =>
      normalizeRepositoryPath(path.relative(ROOT, directory)),
    ),
  ];
  const commitSha = runGit(["rev-parse", "HEAD"]);
  const treeSha = runGit(["rev-parse", "HEAD^{tree}"]);
  const sourceChangeSet = await readGitChangeSet(excludedRoots);
  if (!sourceChangeSet.clean) {
    throw new Error(
      `evidence requires a clean HEAD source tree (${phase}): ${JSON.stringify(
        sourceChangeSet.entries,
      )}`,
    );
  }
  const sourceFingerprint = await readTrackedSourceFingerprint(excludedRoots);
  const sourceChangeSetAfterFingerprint = await readGitChangeSet(excludedRoots);
  if (!isDeepStrictEqual(sourceChangeSetAfterFingerprint, sourceChangeSet)) {
    throw new Error(`source changes moved while reading fingerprint (${phase})`);
  }
  const generatedArtifactChangeSet = await readGitChangeSet([], excludedRoots);
  const sourceChangeSetAfterGeneratedRead = await readGitChangeSet(excludedRoots);
  if (!isDeepStrictEqual(sourceChangeSetAfterGeneratedRead, sourceChangeSet)) {
    throw new Error(`source changes moved while classifying generated artifacts (${phase})`);
  }
  const commitShaAfterRead = runGit(["rev-parse", "HEAD"]);
  const treeShaAfterRead = runGit(["rev-parse", "HEAD^{tree}"]);
  if (commitShaAfterRead !== commitSha || treeShaAfterRead !== treeSha) {
    throw new Error(`HEAD changed while reading source state (${phase})`);
  }
  return {
    commitSha,
    treeSha,
    sourceChangeSet,
    sourceFingerprint,
    generatedArtifactChangeSet,
  };
}

function assertSameSourceState(expected, actual, phase) {
  const selectFinalityFields = (state) => ({
    commitSha: state.commitSha,
    treeSha: state.treeSha,
    sourceChangeSet: state.sourceChangeSet,
    sourceFingerprint: state.sourceFingerprint,
  });
  if (!isDeepStrictEqual(selectFinalityFields(actual), selectFinalityFields(expected))) {
    throw new Error(`source state changed while generating evidence (${phase})`);
  }
}

function assertSameFingerprint(expected, actual, phase) {
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error(`fingerprint changed while generating evidence (${phase})`);
  }
}

async function buildRuntimeFromCleanSource(sourceState) {
  await Promise.all(
    RUNTIME_BUILD_OUTPUT_DIRS.map((directory) =>
      fs.rm(path.join(ROOT, directory), { recursive: true, force: true }),
    ),
  );
  for (const [command, args] of RUNTIME_BUILD_COMMANDS) {
    execFileSync(command, args, {
      cwd: ROOT,
      stdio: ["ignore", "inherit", "inherit"],
    });
  }
  const sourceStateAfterBuild = await readRepositoryState("after forced runtime build");
  assertSameSourceState(sourceState, sourceStateAfterBuild, "after forced runtime build");
  const executableDistFingerprint = await hashFiles(ROOT, IMPORTED_DIST_MODULE_FILES);
  const runtimeDistFingerprint = await hashDirectoryTrees(ROOT, RUNTIME_BUILD_OUTPUT_DIRS);
  return {
    method: "clean-source-forced-build-v1",
    sourceCommitSha: sourceState.commitSha,
    sourceTreeSha: sourceState.treeSha,
    commands: RUNTIME_BUILD_COMMANDS.map(([command, args]) => [command, ...args].join(" ")),
    sourceChangeSet: sourceState.sourceChangeSet,
    trackedSourceFingerprint: sourceState.sourceFingerprint,
    executableDistFingerprint,
    runtimeDistFingerprint,
  };
}

function designColor(x, y) {
  const scaledX = x / 3;
  const scaledY = y / 3;
  if (scaledY < 112) {
    if (scaledX >= 24 && scaledX < 210 && scaledY >= 38 && scaledY < 58) return WHITE;
    return HEADER_COLOR;
  }
  if (scaledY >= 1510 && scaledY < 1570 && scaledX >= 48 && scaledX < 312) {
    return ACCENT_COLOR;
  }

  const section = Math.floor((scaledY - 140) / 220);
  const localY = scaledY - (140 + section * 220);
  if (section >= 0 && localY >= 0 && localY < 154 && scaledX >= 24 && scaledX < 336) {
    const card = CARD_COLORS[section % CARD_COLORS.length];
    if (
      (localY >= 30 && localY < 44 && scaledX >= 50 && scaledX < 238) ||
      (localY >= 72 && localY < 82 && scaledX >= 50 && scaledX < 292) ||
      (localY >= 98 && localY < 108 && scaledX >= 50 && scaledX < 250)
    ) {
      return TEXT_COLOR;
    }
    if (localY >= 24 && localY < 58 && scaledX >= 280 && scaledX < 314) {
      return ACCENT_COLOR;
    }
    return card;
  }
  return SURFACE_COLOR;
}

function buildFixturePixels() {
  const design = Buffer.alloc(WIDTH * STITCHED_HEIGHT * 4);
  const screenshot = Buffer.alloc(design.length);
  for (let y = 0; y < STITCHED_HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const offset = (y * WIDTH + x) * 4;
      const [red, green, blue] = designColor(x, y);
      // 3倍拡大した同色行だけでは71pxと72pxの候補が同点になりうる。
      // 左端の細い決定的バーで、実際の72px移動だけを完全一致にする。
      const rowSignature = (y * 73) % 256;
      design[offset] = x < 12 ? rowSignature : red;
      design[offset + 1] = x < 12 ? (rowSignature + 83) % 256 : green;
      design[offset + 2] = x < 12 ? (rowSignature + 167) % 256 : blue;
      design[offset + 3] = 255;

      if (y < STATUS_BAR_HEIGHT || y >= STITCHED_HEIGHT - NAVIGATION_BAR_HEIGHT) {
        screenshot[offset + 3] = 255;
        continue;
      }
      const sourceOffset = ((y - STATUS_BAR_HEIGHT) * WIDTH + x) * 4;
      screenshot[offset] = design[sourceOffset];
      screenshot[offset + 1] = design[sourceOffset + 1];
      screenshot[offset + 2] = design[sourceOffset + 2];
      screenshot[offset + 3] = design[sourceOffset + 3];
    }
  }
  return { design, screenshot };
}

async function writeFixtureImages(outputDir) {
  const { design, screenshot } = buildFixturePixels();
  await fs.mkdir(outputDir, { recursive: true });
  const designPath = path.join(outputDir, DESIGN_FILENAME);
  const screenshotPath = path.join(outputDir, SCREENSHOT_FILENAME);
  await Promise.all([
    sharp(design, {
      raw: { width: WIDTH, height: STITCHED_HEIGHT, channels: 4 },
    })
      .png()
      .toFile(designPath),
    sharp(screenshot, {
      raw: { width: WIDTH, height: STITCHED_HEIGHT, channels: 4 },
    })
      .png()
      .toFile(screenshotPath),
  ]);
  return { designPath, screenshotPath };
}

async function writeFixtureExpectation(outputDir) {
  const expectation = {
    pairId: "pair-06-system-ui-alignment",
    figmaFrame: DESIGN_FILENAME,
    variants: [
      {
        name: "stitched-system-ui",
        image: SCREENSHOT_FILENAME,
        expectedVerdict: "pass",
        expectedKinds: [],
        expectedIssueKinds: [],
        captureDevice: "android",
        viewportWidth: WIDTH,
        viewportHeight: VIEWPORT_HEIGHT,
        imageWidth: WIDTH,
        imageHeight: STITCHED_HEIGHT,
        ignoreRegions: [
          {
            x: 0,
            y: 0,
            width: WIDTH,
            height: STATUS_BAR_HEIGHT,
            label: "system:status-bar",
          },
          {
            x: 0,
            y: STITCHED_HEIGHT - NAVIGATION_BAR_HEIGHT,
            width: WIDTH,
            height: NAVIGATION_BAR_HEIGHT,
            label: "system:navigation-bar",
          },
        ],
        verifiedSystemUiTopInset: STATUS_BAR_HEIGHT,
        notes:
          "Issue #1579: Pixel 7 presetの1080x2400 viewportを1080x4800へ結合した検体。上端72pxと結合画像末尾72pxを除外し、本文は検証済みinsetと同じ72pxだけ補正する。",
      },
    ],
  };
  await fs.writeFile(
    path.join(outputDir, EXPECTED_FILENAME),
    `${JSON.stringify(expectation, null, 2)}\n`,
  );
}

function stableToolResult(result, diffSha256, diffVisiblePixelCount) {
  const translationIssue = result.diffReport?.issues.find(
    (issue) => issue.evidence.signal === "translation_offset",
  );
  return {
    matchRate: result.matchRate,
    diffPixelCount: result.diffPixelCount,
    totalPixelCount: result.totalPixelCount,
    alignment: result.diffReport?.alignment,
    translationIssueSeverity: translationIssue?.severity ?? null,
    diffSha256,
    diffVisiblePixelCount,
  };
}

async function countVisiblePixels(png) {
  const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let count = 0;
  for (let offset = 3; offset < data.length; offset += 4) {
    if (data[offset] !== 0) count += 1;
  }
  return count;
}

function buildIgnoreMask(ignoreRegions) {
  const mask = new Uint8Array(WIDTH * STITCHED_HEIGHT);
  for (const region of ignoreRegions) {
    const left = Math.max(0, Math.floor(region.x));
    const top = Math.max(0, Math.floor(region.y));
    const right = Math.min(WIDTH, Math.floor(region.x + region.width));
    const bottom = Math.min(STITCHED_HEIGHT, Math.floor(region.y + region.height));
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        mask[y * WIDTH + x] = 1;
      }
    }
  }
  return mask;
}

async function computeIndependentResidual(ignoreRegions, designPath, screenshotPath) {
  const [{ data: design }, { data: screenshot }] = await Promise.all([
    sharp(designPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(screenshotPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  const ignoreMask = buildIgnoreMask(ignoreRegions);
  const alignedDesign = Buffer.alloc(design.length);
  const residual = Buffer.alloc(design.length);
  let evaluatedPixelCount = 0;
  let residualPixelCount = 0;
  let maxChannelDelta = 0;

  for (let y = 0; y < STITCHED_HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const pixel = y * WIDTH + x;
      const offset = pixel * 4;
      if (ignoreMask[pixel] !== 0) {
        screenshot.copy(alignedDesign, offset, offset, offset + 4);
        residual[offset + 3] = 255;
        continue;
      }

      const sourceY = y - STATUS_BAR_HEIGHT;
      if (sourceY < 0 || sourceY >= STITCHED_HEIGHT) {
        throw new Error(`independent transform left the design bounds at y=${y}`);
      }
      const sourceOffset = (sourceY * WIDTH + x) * 4;
      design.copy(alignedDesign, offset, sourceOffset, sourceOffset + 4);
      const redDelta = Math.abs(design[sourceOffset] - screenshot[offset]);
      const greenDelta = Math.abs(design[sourceOffset + 1] - screenshot[offset + 1]);
      const blueDelta = Math.abs(design[sourceOffset + 2] - screenshot[offset + 2]);
      residual[offset] = redDelta;
      residual[offset + 1] = greenDelta;
      residual[offset + 2] = blueDelta;
      residual[offset + 3] = 255;
      evaluatedPixelCount += 1;
      const pixelDelta = Math.max(redDelta, greenDelta, blueDelta);
      maxChannelDelta = Math.max(maxChannelDelta, pixelDelta);
      if (pixelDelta > 0) residualPixelCount += 1;
    }
  }

  const [alignedDesignPng, residualPng] = await Promise.all([
    sharp(alignedDesign, {
      raw: { width: WIDTH, height: STITCHED_HEIGHT, channels: 4 },
    })
      .png()
      .toBuffer(),
    sharp(residual, {
      raw: { width: WIDTH, height: STITCHED_HEIGHT, channels: 4 },
    })
      .png()
      .toBuffer(),
  ]);
  return {
    alignedDesignPng,
    residualPng,
    metrics: {
      evaluatedPixelCount,
      residualPixelCount,
      maxChannelDelta,
      residualSha256: createHash("sha256").update(residualPng).digest("hex"),
    },
  };
}

async function writeComparisonSheet(outputDir, tool, independent, images) {
  const columnWidth = WIDTH;
  const headerHeight = 210;
  const sheetWidth = columnWidth * 4;
  const sheetHeight = headerHeight + STITCHED_HEIGHT;
  const labels = ["Synthetic fixture", "Aligned design", "Capture", "Independent residual"];
  const labelMarkup = labels
    .map(
      (label, index) =>
        `<text x="${index * columnWidth + 20}" y="190" font-size="24" font-weight="700" fill="#ffffff">${label}</text>`,
    )
    .join("");
  const header = Buffer.from(`
    <svg width="${sheetWidth}" height="${headerHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#16283f"/>
      <text x="20" y="38" font-size="28" font-weight="700" fill="#ffffff">Issue #1579 system UI alignment evidence</text>
      <text x="20" y="70" font-size="21" fill="#ffd166">Synthetic fixture, not device evidence</text>
      <text x="20" y="105" font-size="20" fill="#ffffff">Accepted translation: x=${tool.alignment.translation.x}px, y=${tool.alignment.translation.y}px</text>
      <text x="20" y="135" font-size="20" fill="#ffffff">Tool: match ${tool.matchRate.toFixed(2)}%, diff ${tool.diffPixelCount}/${tool.totalPixelCount}, visible diff ${tool.diffVisiblePixelCount}px</text>
      <text x="20" y="165" font-size="20" fill="#ffffff">Independent: evaluated ${independent.evaluatedPixelCount}px, residual ${independent.residualPixelCount}px, max delta ${independent.maxChannelDelta}</text>
      ${labelMarkup}
    </svg>
  `);
  await sharp({
    create: {
      width: sheetWidth,
      height: sheetHeight,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([
      { input: header, left: 0, top: 0 },
      { input: images.design, left: 0, top: headerHeight },
      { input: images.alignedDesign, left: columnWidth, top: headerHeight },
      { input: images.capture, left: columnWidth * 2, top: headerHeight },
      { input: images.residual, left: columnWidth * 3, top: headerHeight },
    ])
    .png()
    .toFile(path.join(outputDir, "comparison-sheet.png"));
}

const publishDirectoriesAtomically = async (directories, assertPublishedState) => {
  const transactionId = `${process.pid}-${Date.now()}`;
  const entries = directories.map(({ stagingDir, targetDir }) => ({
    stagingDir,
    targetDir,
    backupDir: `${targetDir}.backup-${transactionId}`,
    targetExisted: false,
    installed: false,
  }));
  let succeeded = false;
  let publicationError;
  let rollbackError;
  let cleanupError;

  try {
    for (const entry of entries) {
      try {
        await fs.rename(entry.targetDir, entry.backupDir);
        entry.targetExisted = true;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    for (const entry of entries) {
      await fs.rename(entry.stagingDir, entry.targetDir);
      entry.installed = true;
    }
    await assertPublishedState(entries);
    succeeded = true;
  } catch (error) {
    publicationError = error;
  } finally {
    const rollbackErrors = [];
    if (!succeeded) {
      for (const entry of [...entries].reverse()) {
        try {
          if (entry.installed) {
            await fs.rm(entry.targetDir, { recursive: true, force: true });
          }
          if (entry.targetExisted) {
            await fs.rename(entry.backupDir, entry.targetDir);
          }
        } catch (error) {
          rollbackErrors.push(error);
        }
      }
    }
    if (rollbackErrors.length > 0) {
      rollbackError = new AggregateError(rollbackErrors, "evidence publication rollback failed");
    } else {
      try {
        await Promise.all(
          entries.map((entry) => fs.rm(entry.backupDir, { recursive: true, force: true })),
        );
      } catch (error) {
        cleanupError = error;
      }
    }
  }
  if (publicationError) {
    if (rollbackError) process.emitWarning(rollbackError);
    throw publicationError;
  }
  if (rollbackError) throw rollbackError;
  if (cleanupError) throw cleanupError;
};

async function hashFiles(baseDir, filenames) {
  const entries = await Promise.all(
    filenames.map(async (filename) => {
      const buffer = await fs.readFile(path.join(baseDir, filename));
      return [filename, buffer];
    }),
  );
  const fileSha256 = Object.fromEntries(
    entries.map(([filename, buffer]) => [
      filename,
      createHash("sha256").update(buffer).digest("hex"),
    ]),
  );
  const bundleHash = createHash("sha256");
  for (const [filename, buffer] of entries) {
    bundleHash.update(filename);
    bundleHash.update("\0");
    bundleHash.update(String(buffer.length));
    bundleHash.update("\0");
    bundleHash.update(buffer);
  }
  return {
    bundleSha256: bundleHash.digest("hex"),
    fileSha256,
  };
}

async function hashDirectoryTrees(baseDir, directories) {
  const filenames = [];
  for (const directory of directories) {
    const pending = [directory];
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current) continue;
      const entries = await fs.readdir(path.join(baseDir, current), { withFileTypes: true });
      for (const entry of entries) {
        const relativePath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          pending.push(relativePath);
        } else if (entry.isFile()) {
          filenames.push(relativePath);
        } else {
          throw new Error(`runtime dist contains an unsupported entry: ${relativePath}`);
        }
      }
    }
  }
  filenames.sort();
  return hashFiles(baseDir, filenames);
}

async function assertEvidenceBundle(evidenceDir, summary) {
  const requiredFiles = [...EVIDENCE_IMAGE_FILENAMES, "summary.json"].sort();
  const actualFiles = (await fs.readdir(evidenceDir)).sort();
  if (!isDeepStrictEqual(actualFiles, requiredFiles)) {
    throw new Error(`incomplete evidence bundle: ${JSON.stringify(actualFiles)}`);
  }
  const persistedSummary = JSON.parse(
    await fs.readFile(path.join(evidenceDir, "summary.json"), "utf8"),
  );
  if (!isDeepStrictEqual(persistedSummary, summary)) {
    throw new Error("persisted evidence summary does not match the asserted run");
  }
}

async function main() {
  const executedAt = new Date().toISOString();
  const sourceState = await readRepositoryState("before forced runtime build");
  const buildAttestation = await buildRuntimeFromCleanSource(sourceState);
  const fixtureParent = path.dirname(FIXTURE_DIR);
  const evidenceParent = path.dirname(EVIDENCE_DIR);
  await Promise.all([
    fs.mkdir(fixtureParent, { recursive: true }),
    fs.mkdir(evidenceParent, { recursive: true }),
  ]);
  const fixtureStagingDir = await fs.mkdtemp(
    path.join(fixtureParent, ".pair-06-system-ui-alignment-"),
  );
  const evidenceStagingDir = await fs.mkdtemp(
    path.join(evidenceParent, ".issue-1579-system-ui-mask-"),
  );

  try {
    await writeFixtureExpectation(fixtureStagingDir);
    const { designPath, screenshotPath } = await writeFixtureImages(fixtureStagingDir);
    const [
      { buildSystemBarIgnoreRegions, resolveFixtureVerifiedSystemUiTopInset },
      { compareImages },
    ] = await Promise.all([
      import("../../package/shared/dist/index.js"),
      import("../../app/mcp-server/dist/service/image-compare-service.js"),
    ]);
    const importedDistModuleFingerprintAfterImport = await hashFiles(
      ROOT,
      IMPORTED_DIST_MODULE_FILES,
    );
    assertSameFingerprint(
      buildAttestation.executableDistFingerprint,
      importedDistModuleFingerprintAfterImport,
      "immediately after runtime import",
    );
    const runtimeDistFingerprintAfterImport = await hashDirectoryTrees(
      ROOT,
      RUNTIME_BUILD_OUTPUT_DIRS,
    );
    assertSameFingerprint(
      buildAttestation.runtimeDistFingerprint,
      runtimeDistFingerprintAfterImport,
      "full runtime dist immediately after import",
    );
    const verifiedSystemUiTopInset = resolveFixtureVerifiedSystemUiTopInset(
      {
        captureDevice: "android",
        viewportWidth: WIDTH,
        viewportHeight: VIEWPORT_HEIGHT,
        imageWidth: WIDTH,
        imageHeight: STITCHED_HEIGHT,
        verifiedSystemUiTopInset: STATUS_BAR_HEIGHT,
      },
      { width: WIDTH, height: STITCHED_HEIGHT },
    );
    if (verifiedSystemUiTopInset !== STATUS_BAR_HEIGHT) {
      throw new Error(
        `fixture does not resolve the production preset: ${verifiedSystemUiTopInset ?? "none"}`,
      );
    }
    const ignoreRegions = buildSystemBarIgnoreRegions(
      WIDTH,
      VIEWPORT_HEIGHT,
      "android",
      undefined,
      STITCHED_HEIGHT,
    );
    const expectedRegions = [
      {
        x: 0,
        y: 0,
        width: WIDTH,
        height: STATUS_BAR_HEIGHT,
        label: "system:status-bar",
      },
      {
        x: 0,
        y: STITCHED_HEIGHT - NAVIGATION_BAR_HEIGHT,
        width: WIDTH,
        height: NAVIGATION_BAR_HEIGHT,
        label: "system:navigation-bar",
      },
    ];
    if (!isDeepStrictEqual(ignoreRegions, expectedRegions)) {
      throw new Error(`system UI mask mismatch: ${JSON.stringify(ignoreRegions)}`);
    }

    const [designBuffer, screenshotBuffer] = await Promise.all([
      fs.readFile(designPath),
      fs.readFile(screenshotPath),
    ]);
    const designBase64 = designBuffer.toString("base64");
    const screenshotBase64 = screenshotBuffer.toString("base64");
    await Promise.all([
      fs.writeFile(path.join(evidenceStagingDir, "figma-export.png"), designBuffer),
      fs.writeFile(path.join(evidenceStagingDir, "stitched-capture.png"), screenshotBuffer),
    ]);

    const independent = await computeIndependentResidual(ignoreRegions, designPath, screenshotPath);
    const runs = [];
    const firstIndependent = independent;
    await fs.writeFile(
      path.join(evidenceStagingDir, "aligned-design.png"),
      independent.alignedDesignPng,
    );
    for (let run = 1; run <= RUN_COUNT; run += 1) {
      const result = await compareImages({
        designBase64,
        screenshotBase64,
        threshold: 0,
        ignoreRegions,
        verifiedSystemUiTopInset,
      });
      const diff = Buffer.from(result.diffImageBase64, "base64");
      const diffSha256 = createHash("sha256").update(diff).digest("hex");
      const diffVisiblePixelCount = await countVisiblePixels(diff);
      await fs.writeFile(path.join(evidenceStagingDir, `diff-run-${run}.png`), diff);
      await fs.writeFile(
        path.join(evidenceStagingDir, `residual-run-${run}.png`),
        independent.residualPng,
      );
      const stable = {
        tool: stableToolResult(result, diffSha256, diffVisiblePixelCount),
        independent: independent.metrics,
      };
      if (
        stable.tool.matchRate !== 100 ||
        stable.tool.diffPixelCount !== 0 ||
        stable.tool.diffVisiblePixelCount !== 0 ||
        stable.tool.alignment?.translation.x !== 0 ||
        stable.tool.alignment?.translation.y !== verifiedSystemUiTopInset ||
        stable.tool.translationIssueSeverity !== null ||
        stable.independent.evaluatedPixelCount !==
          WIDTH * (STITCHED_HEIGHT - STATUS_BAR_HEIGHT - NAVIGATION_BAR_HEIGHT) ||
        stable.independent.residualPixelCount !== 0 ||
        stable.independent.maxChannelDelta !== 0
      ) {
        throw new Error(`unexpected run ${run}: ${JSON.stringify(stable)}`);
      }
      runs.push(stable);
    }

    if (!runs.every((run) => isDeepStrictEqual(run, runs[0]))) {
      throw new Error(`three-run stability mismatch: ${JSON.stringify(runs)}`);
    }
    if (!firstIndependent || !runs[0]) {
      throw new Error("comparison evidence was not generated");
    }
    await writeComparisonSheet(evidenceStagingDir, runs[0].tool, firstIndependent.metrics, {
      design: designBuffer,
      alignedDesign: firstIndependent.alignedDesignPng,
      capture: screenshotBuffer,
      residual: firstIndependent.residualPng,
    });
    const fixtureHash = await hashFiles(fixtureStagingDir, [
      DESIGN_FILENAME,
      SCREENSHOT_FILENAME,
      EXPECTED_FILENAME,
    ]);
    const evidenceImageHash = await hashFiles(evidenceStagingDir, EVIDENCE_IMAGE_FILENAMES);
    const finalSourceState = await readRepositoryState("before evidence publication", [
      fixtureStagingDir,
      evidenceStagingDir,
    ]);
    assertSameSourceState(sourceState, finalSourceState, "before evidence publication");
    const importedDistModuleFingerprint = await hashFiles(ROOT, IMPORTED_DIST_MODULE_FILES);
    assertSameFingerprint(
      buildAttestation.executableDistFingerprint,
      importedDistModuleFingerprint,
      "before evidence publication",
    );
    const runtimeDistFingerprint = await hashDirectoryTrees(ROOT, RUNTIME_BUILD_OUTPUT_DIRS);
    assertSameFingerprint(
      buildAttestation.runtimeDistFingerprint,
      runtimeDistFingerprint,
      "full runtime dist before evidence publication",
    );
    const summary = {
      issue: 1579,
      evidenceType: "synthetic-fixture",
      deviceEvidence: false,
      executedAt,
      commitSha: sourceState.commitSha,
      sourceTreeSha: sourceState.treeSha,
      workingTreeDirty: false,
      fixtureHash,
      evidenceImageHash,
      implementationSourceFingerprint: sourceState.sourceFingerprint,
      sourceDiffFingerprint: sourceState.sourceChangeSet,
      importedDistModuleFingerprint,
      runtimeDistFingerprint,
      buildAttestation,
      provenancePolicy: {
        sourceChangeDiscovery: "git-status-index-diff-worktree-diff-head-diff-v1",
        trackedSourceDiscovery: "git-ls-files-v1",
        generatedArtifactsExcludedFromFinality: GENERATED_ARTIFACT_ROOTS,
      },
      evidenceEligibility: {
        status: "final",
        mayBeUsedAsCompletionEvidence: true,
        regenerateAfterCleanImplementationCommit:
          "node verification/script/verify-system-ui-mask-alignment.mjs",
      },
      productionPreset: {
        platform: "android",
        width: WIDTH,
        height: VIEWPORT_HEIGHT,
        stitchedOutputHeight: STITCHED_HEIGHT,
        verifiedSystemUiTopInset,
      },
      ignoreRegions,
      runs,
    };
    await fs.writeFile(
      path.join(evidenceStagingDir, "summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
    await assertEvidenceBundle(evidenceStagingDir, summary);

    await publishDirectoriesAtomically(
      [
        { stagingDir: fixtureStagingDir, targetDir: FIXTURE_DIR },
        { stagingDir: evidenceStagingDir, targetDir: EVIDENCE_DIR },
      ],
      async (transactionEntries) => {
        await assertEvidenceBundle(EVIDENCE_DIR, summary);
        const sourceStateAfterPublication = await readRepositoryState(
          "after evidence publication",
          transactionEntries.filter((entry) => entry.targetExisted).map((entry) => entry.backupDir),
        );
        assertSameSourceState(
          sourceState,
          sourceStateAfterPublication,
          "after evidence publication",
        );
        const distFingerprintAfterPublication = await hashFiles(ROOT, IMPORTED_DIST_MODULE_FILES);
        assertSameFingerprint(
          buildAttestation.executableDistFingerprint,
          distFingerprintAfterPublication,
          "after evidence publication",
        );
        const runtimeDistFingerprintAfterPublication = await hashDirectoryTrees(
          ROOT,
          RUNTIME_BUILD_OUTPUT_DIRS,
        );
        assertSameFingerprint(
          buildAttestation.runtimeDistFingerprint,
          runtimeDistFingerprintAfterPublication,
          "full runtime dist after evidence publication",
        );
      },
    );
    await new Promise((resolve, reject) => {
      process.stdout.write(
        `${JSON.stringify(
          { fixtureDir: FIXTURE_DIR, evidenceDir: EVIDENCE_DIR, summary },
          null,
          2,
        )}\n`,
        (error) => {
          if (error) reject(error);
          else resolve();
        },
      );
    });
  } finally {
    await Promise.all([
      fs.rm(fixtureStagingDir, { recursive: true, force: true }),
      fs.rm(evidenceStagingDir, { recursive: true, force: true }),
    ]);
  }
}

await runWithExclusiveProcessLock(
  {
    repositoryRoot: ROOT,
    task: TASK_LOCK_NAME,
  },
  main,
);
