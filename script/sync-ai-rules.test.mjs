import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import baseTest from "node:test";

// すべてのテストは実リポジトリではなく、リポジトリのファイルを写した一時ディレクトリで動かす。
const root = join(import.meta.dirname, "..");
const SCRIPT_REL = "script/sync-ai-rules.sh";

const GEMINI = ".gemini/styleguide.md";
const COPILOT = ".github/copilot-instructions.md";
const ALPHA_SOURCE = ".agents/skills/alpha/SKILL.md";
const ALPHA_GENERATED = ".claude/skills/alpha/SKILL.md";
const markerFor = (name) =>
  `<!-- AUTO-GENERATED from .agents/skills/${name}/SKILL.md by script/sync-ai-rules.sh. DO NOT EDIT: edit the source, then run bash script/sync-ai-rules.sh -->`;
const ALPHA_MARKER = markerFor("alpha");

// 本文に 2 つ目の `---` ブロックを持ち、末尾改行なしで終わる SKILL.md。
const ALPHA_SKILL = [
  "---",
  "name: alpha",
  "description: Alpha skill used by the sync tests",
  "---",
  "",
  "# Alpha",
  "",
  "---",
  'applyTo: "**"',
  "---",
  "",
  "body without trailing newline",
].join("\n");
// NUL と CR を含み、末尾改行もない補助ファイル。バイト単位のコピーを検証する。
const BINARY_FILE = Buffer.from([0x00, 0x0d, 0x0a, 0xff, 0xfe, 0x41, 0x0d, 0x00, 0x7f]);

const hasBash = spawnSync("bash", ["--version"]).status === 0;
if (!hasBash) console.warn("bash not found: sync-ai-rules tests are skipped");
// bash が無い環境 (素の Windows など) ではこのファイルのテストをまとめてスキップする。
const test = (name, optionsOrFn, maybeFn) => {
  const [options, fn] =
    typeof optionsOrFn === "function" ? [{}, optionsOrFn] : [optionsOrFn, maybeFn];
  return baseTest(name, { ...options, skip: options.skip || !hasBash }, fn);
};
test.after = baseTest.after;

const tempRoots = [];
const makeTemp = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
};
test.after(() => {
  for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true });
});

const write = (base, path, content) => {
  const target = join(base, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  return target;
};

const createFixture = () => {
  const fixture = makeTemp("figdiff-sync-ai-rules-");
  mkdirSync(join(fixture, "script"));
  copyFileSync(join(root, SCRIPT_REL), join(fixture, SCRIPT_REL));
  copyFileSync(join(root, "AGENTS.md"), join(fixture, "AGENTS.md"));
  cpSync(join(root, ".agents/skills"), join(fixture, ".agents/skills"), { recursive: true });
  write(fixture, ALPHA_SOURCE, ALPHA_SKILL);
  write(fixture, ".agents/skills/alpha/reference/data.bin", BINARY_FILE);
  const helper = write(fixture, ".agents/skills/alpha/helper.sh", "#!/bin/sh\necho helper\n");
  chmodSync(helper, 0o755);
  return fixture;
};

const sync = (fixture, ...args) =>
  spawnSync("bash", [join(fixture, SCRIPT_REL), ...args], { cwd: fixture, encoding: "utf8" });

const listFiles = (base, dir = base) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(base, path) : [relative(base, path)];
  });

const snapshot = (fixture) =>
  Object.fromEntries(
    listFiles(fixture)
      .sort()
      .map((file) => [
        file,
        createHash("sha256")
          .update(readFileSync(join(fixture, file)))
          .digest("hex"),
      ]),
  );

const syncOk = (fixture) => {
  const result = sync(fixture);
  assert.equal(result.status, 0, result.stderr);
  return result;
};

test("write mode is idempotent: a second run changes nothing", () => {
  const fixture = createFixture();
  syncOk(fixture);
  const first = snapshot(fixture);
  const second = syncOk(fixture);
  assert.deepEqual(snapshot(fixture), first);
  assert.match(second.stdout, /0 written, 0 orphan\(s\) removed/);
  for (const output of [GEMINI, COPILOT, ALPHA_GENERATED])
    assert.ok(existsSync(join(fixture, output)), output);
});

test("--check passes on a clean tree and never writes", () => {
  const fixture = createFixture();
  syncOk(fixture);
  const before = snapshot(fixture);
  const result = sync(fixture, "--check");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^OK: AI rules in sync/);
  assert.deepEqual(snapshot(fixture), before);
});

test("--check fails on a hand-edited generated file and leaves the tree untouched", () => {
  for (const output of [COPILOT, GEMINI, ALPHA_GENERATED]) {
    const fixture = createFixture();
    syncOk(fixture);
    const target = join(fixture, output);
    writeFileSync(target, `${readFileSync(target, "utf8")}hand edit\n`);
    const before = snapshot(fixture);
    const result = sync(fixture, "--check");
    assert.equal(result.status, 1, output);
    assert.match(result.stderr, new RegExp(`DRIFT: differs\\s+${output.replaceAll(".", "\\.")}`));
    assert.deepEqual(snapshot(fixture), before, "--check must not repair the drift");
  }
});

test("--check fails when an expected output is missing", () => {
  const fixture = createFixture();
  const fresh = sync(fixture, "--check");
  assert.equal(fresh.status, 1, "outputs that were never generated must not pass");
  assert.match(fresh.stderr, /DRIFT: missing\s+\.gemini\/styleguide\.md/);
  syncOk(fixture);
  rmSync(join(fixture, ALPHA_GENERATED));
  const result = sync(fixture, "--check");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /DRIFT: missing\s+\.claude\/skills\/alpha\/SKILL\.md/);
});

test("an orphan stub fails --check and write mode deletes it", () => {
  const fixture = createFixture();
  syncOk(fixture);
  write(
    fixture,
    ".claude/skills/ghost/SKILL.md",
    `---\nname: ghost\ndescription: gone\n---\n${markerFor("ghost")}\n`,
  );
  const checked = sync(fixture, "--check");
  assert.equal(checked.status, 1);
  assert.match(checked.stderr, /DRIFT: orphan\s+\.claude\/skills\/ghost/);
  assert.ok(existsSync(join(fixture, ".claude/skills/ghost/SKILL.md")), "--check must not delete");
  const written = syncOk(fixture);
  assert.match(written.stdout, /Removed orphan: .*\.claude\/skills\/ghost/);
  assert.equal(existsSync(join(fixture, ".claude/skills/ghost")), false);
  assert.equal(sync(fixture, "--check").status, 0);
});

test("a stale supporting file inside a generated skill is an orphan too", () => {
  const fixture = createFixture();
  syncOk(fixture);
  write(fixture, ".claude/skills/alpha/reference/stale.txt", "left over\n");
  const checked = sync(fixture, "--check");
  assert.equal(checked.status, 1);
  assert.match(checked.stderr, /DRIFT: orphan\s+\.claude\/skills\/alpha\/reference\/stale\.txt/);
  syncOk(fixture);
  assert.equal(existsSync(join(fixture, ".claude/skills/alpha/reference/stale.txt")), false);
  assert.ok(existsSync(join(fixture, ".claude/skills/alpha/reference/data.bin")));
  assert.equal(sync(fixture, "--check").status, 0);
});

test("a hand-written .claude/skills/<n> without the marker is never overwritten", () => {
  for (const args of [[], ["--check"]]) {
    const fixture = createFixture();
    const handWritten = "---\nname: alpha\ndescription: hand written\n---\nmine\n";
    write(fixture, ALPHA_GENERATED, handWritten);
    const result = sync(fixture, ...args);
    assert.equal(result.status, 1, args.join(" "));
    assert.match(result.stderr, /without a generated SKILL\.md marker/);
    assert.equal(readFileSync(join(fixture, ALPHA_GENERATED), "utf8"), handWritten);
    assert.equal(
      existsSync(join(fixture, GEMINI)),
      false,
      "nothing may be written when the guard trips",
    );
    assert.equal(existsSync(join(fixture, COPILOT)), false);
  }
});

test("a hand-written skill that merely quotes a marker in its body is not an orphan", () => {
  const fixture = createFixture();
  syncOk(fixture);
  const handWritten = `---\nname: debug-issue\ndescription: hand written\n---\n\nExample marker:\n${markerFor("foo")}\n`;
  write(fixture, ".claude/skills/debug-issue/SKILL.md", handWritten);
  // marker placed right after frontmatter but naming another skill
  const other = `---\nname: other\ndescription: x\n---\n${markerFor("foo")}\n`;
  write(fixture, ".claude/skills/other/SKILL.md", other);
  const result = syncOk(fixture);
  assert.doesNotMatch(result.stdout, /Removed orphan/);
  assert.equal(
    readFileSync(join(fixture, ".claude/skills/debug-issue/SKILL.md"), "utf8"),
    handWritten,
  );
  assert.equal(readFileSync(join(fixture, ".claude/skills/other/SKILL.md"), "utf8"), other);
  assert.equal(sync(fixture, "--check").status, 0);
});

test("an existing .claude/skills/<n> directory without a generated SKILL.md is refused", () => {
  const fixture = createFixture();
  const notes = write(fixture, ".claude/skills/alpha/notes.md", "mine\n");
  const result = sync(fixture);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not generated/);
  assert.equal(readFileSync(notes, "utf8"), "mine\n");
  assert.equal(existsSync(join(fixture, ALPHA_GENERATED)), false);
});

test("CRLF checkouts (core.autocrlf) do not trip the collision guard or hide orphans", () => {
  const fixture = createFixture();
  syncOk(fixture);
  const crlf = (path) => {
    const target = join(fixture, path);
    writeFileSync(target, readFileSync(target, "utf8").replaceAll("\n", "\r\n"));
  };
  crlf(ALPHA_GENERATED);
  write(
    fixture,
    ".claude/skills/ghost/SKILL.md",
    `---\r\nname: ghost\r\n---\r\n${markerFor("ghost")}\r\n`,
  );
  const checked = sync(fixture, "--check");
  assert.equal(checked.status, 1);
  assert.doesNotMatch(checked.stderr, /without a generated SKILL\.md marker/);
  assert.match(checked.stderr, /DRIFT: orphan\s+\.claude\/skills\/ghost/);
  syncOk(fixture);
  assert.equal(sync(fixture, "--check").status, 0);
});

test("--check detects an executable-bit difference", { skip: process.platform === "win32" }, () => {
  const fixture = createFixture();
  syncOk(fixture);
  chmodSync(join(fixture, ".claude/skills/alpha/helper.sh"), 0o644);
  const result = sync(fixture, "--check");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /DRIFT: differs\s+\.claude\/skills\/alpha\/helper\.sh/);
  syncOk(fixture);
  assert.equal(sync(fixture, "--check").status, 0);
});

test("generated skills are byte copies with the marker right after the closing frontmatter", () => {
  const fixture = createFixture();
  syncOk(fixture);
  const generated = readFileSync(join(fixture, ALPHA_GENERATED), "utf8");
  const expected = ALPHA_SKILL.replace(
    "description: Alpha skill used by the sync tests\n---\n",
    (head) => `${head}${ALPHA_MARKER}\n`,
  );
  assert.equal(generated, expected);
  assert.ok(generated.startsWith("---\nname: alpha\n"), "frontmatter must stay first");
  assert.equal(generated.split(ALPHA_MARKER).length, 2, "exactly one marker");
  assert.ok(generated.endsWith("body without trailing newline"), "trailing bytes preserved");
  assert.deepEqual(
    readFileSync(join(fixture, ".claude/skills/alpha/reference/data.bin")),
    BINARY_FILE,
  );
  assert.equal(
    readFileSync(join(fixture, ".claude/skills/alpha/helper.sh"), "utf8"),
    "#!/bin/sh\necho helper\n",
  );
  assert.equal(
    statSync(join(fixture, ".claude/skills/alpha/helper.sh")).mode & 0o111,
    0o111,
    "exec bit preserved",
  );
  // 実在するスキルも、移動後の本文を 1 行のマーカー以外そのまま持つ。
  for (const name of ["git-workflow", "verification-mandate"]) {
    const source = readFileSync(join(fixture, `.agents/skills/${name}/SKILL.md`), "utf8").split(
      "\n",
    );
    const copy = readFileSync(join(fixture, `.claude/skills/${name}/SKILL.md`), "utf8").split("\n");
    assert.equal(copy.length, source.length + 1, name);
    assert.deepEqual([...copy.slice(0, 4), ...copy.slice(5)], source, name);
    assert.match(
      copy[4],
      /^<!-- AUTO-GENERATED from \.agents\/skills\/.+\/SKILL\.md by script\/sync-ai-rules\.sh/,
    );
  }
});

test("a SKILL.md without a closed frontmatter block aborts before anything is written", () => {
  const fixture = createFixture();
  write(fixture, ALPHA_SOURCE, "# no frontmatter\n");
  const result = sync(fixture);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must start with a YAML frontmatter/);
  assert.equal(existsSync(join(fixture, GEMINI)), false);
  assert.equal(existsSync(join(fixture, ".claude/skills")), false);
});

test("encrypted (git-crypt) sources are refused, not copied", () => {
  const fixture = createFixture();
  write(
    fixture,
    ALPHA_SOURCE,
    Buffer.concat([Buffer.from([0]), Buffer.from("GITCRYPT"), Buffer.from([0, 1, 2, 3])]),
  );
  const result = sync(fixture);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /encrypted/);
  assert.equal(existsSync(join(fixture, ALPHA_GENERATED)), false);
});

test("unknown arguments are rejected", () => {
  const fixture = createFixture();
  const result = sync(fixture, "--nope");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage:/);
});

test("broken committed symlinks only warn", { skip: process.platform === "win32" }, () => {
  const fixture = createFixture();
  syncOk(fixture);
  mkdirSync(join(fixture, ".claude/rules"), { recursive: true });
  symlinkSync("../../prompt/instruction/missing.md", join(fixture, ".claude/rules/missing.md"));
  const result = sync(fixture, "--check");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /WARN: broken symlink: \.claude\/rules\/missing\.md/);
});

// ---------------------------------------------------------------------------
// Golden: the two legacy outputs stay byte-identical to the pre-refactor script.
// script/fixture/legacy-sync-ai-rules.sh is that script, verbatim from git history.
// ---------------------------------------------------------------------------
const realAgents = readFileSync(join(root, "AGENTS.md"), "utf8");
const agentsVariants = {
  "the real AGENTS.md": realAgents,
  "no trailing newline": "# T\n\nbody",
  "many trailing newlines": "# T\n\nbody\n\n\n\n",
  "printf and shell metacharacters": "100% %s %d \\n \\\\ $HOME `date` $(echo no) \"q\" 'q'\n",
  "leading blank lines": "\n\nlead\n",
  "CRLF line endings": "a\r\nb\r\n",
};

for (const [label, content] of Object.entries(agentsVariants)) {
  test(`golden: legacy outputs are byte-identical for ${label}`, () => {
    const legacy = makeTemp("figdiff-sync-legacy-");
    mkdirSync(join(legacy, "script"));
    copyFileSync(join(root, "script/fixture/legacy-sync-ai-rules.sh"), join(legacy, SCRIPT_REL));
    writeFileSync(join(legacy, "AGENTS.md"), content);
    const old = spawnSync("bash", [join(legacy, SCRIPT_REL)], { cwd: legacy, encoding: "utf8" });
    assert.equal(old.status, 0, old.stderr);

    const current = makeTemp("figdiff-sync-current-");
    mkdirSync(join(current, "script"));
    copyFileSync(join(root, SCRIPT_REL), join(current, SCRIPT_REL));
    writeFileSync(join(current, "AGENTS.md"), content);
    syncOk(current);

    for (const output of [GEMINI, COPILOT]) {
      assert.ok(
        readFileSync(join(legacy, output)).equals(readFileSync(join(current, output))),
        `${output} differs from the legacy output`,
      );
    }
  });
}
