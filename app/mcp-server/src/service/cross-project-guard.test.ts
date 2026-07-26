import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  collectProjectNames,
  detectForeignProjectNames,
  formatForeignProjectError,
} from "./cross-project-guard.js";

const KNOWN = ["acme-inc", "widget-native", "widget-web", "designdiff", "kouiso", "prompt", "docs"];

describe("detectForeignProjectNames", () => {
  it("他プロジェクトのリポジトリ名を検出する", async () => {
    const hits = await detectForeignProjectNames("widget-native で踏んだバグ", {
      knownNames: KNOWN,
    });
    expect(hits).toEqual(["widget-native"]);
  });

  it("他組織名を検出する", async () => {
    const hits = await detectForeignProjectNames("acme-inc の案件で再現しました", {
      knownNames: KNOWN,
    });
    expect(hits).toEqual(["acme-inc"]);
  });

  it("複数含まれていれば全部返す", async () => {
    const hits = await detectForeignProjectNames("widget-web と acme-inc の両方", {
      knownNames: KNOWN,
    });
    expect(hits).toEqual(["acme-inc", "widget-web"]);
  });

  it("自リポジトリ名は検出しない", async () => {
    const hits = await detectForeignProjectNames(
      "designdiff の crop がずれる (kouiso/designdiff)",
      {
        knownNames: KNOWN,
      },
    );
    expect(hits).toEqual([]);
  });

  it("一般語は検出しない", async () => {
    const hits = await detectForeignProjectNames("prompt と docs を更新した", {
      knownNames: KNOWN,
    });
    expect(hits).toEqual([]);
  });

  it("部分一致では発火しない", async () => {
    const hits = await detectForeignProjectNames("widget-native-plus という別語", {
      knownNames: KNOWN,
    });
    expect(hits).toEqual([]);
  });

  it("大文字小文字を区別しない", async () => {
    const hits = await detectForeignProjectNames("ACME-INC で発生", { knownNames: KNOWN });
    expect(hits).toEqual(["acme-inc"]);
  });

  it("5文字未満の名前は識別子として扱わない", async () => {
    const hits = await detectForeignProjectNames("abc の話", { knownNames: ["abc"] });
    expect(hits).toEqual([]);
  });

  it("判定語が1件も無ければ素通しする", async () => {
    const hits = await detectForeignProjectNames("widget-native", { knownNames: [] });
    expect(hits).toEqual([]);
  });

  it("正規表現のメタ文字を含む名前でも壊れない", async () => {
    const hits = await detectForeignProjectNames("plain text", { knownNames: ["a+b(c)"] });
    expect(hits).toEqual([]);
  });
});

describe("collectProjectNames", () => {
  let root = "";

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(tmpdir(), "figdiff-guard-"));
    await fs.mkdir(path.join(root, "acme-inc", "widget-web"), { recursive: true });
    await fs.mkdir(path.join(root, "acme-inc", "widget-api-worktrees"), { recursive: true });
    await fs.mkdir(path.join(root, "kouiso", "designdiff"), { recursive: true });
    await fs.writeFile(path.join(root, "stray-file.txt"), "x");
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("owner と repo の両方を集める", async () => {
    const names = await collectProjectNames({ projectRoot: root });
    expect(names).toContain("acme-inc");
    expect(names).toContain("widget-web");
    expect(names).toContain("kouiso");
    expect(names).toContain("designdiff");
  });

  it("worktree 派生名から本体名も取り出す", async () => {
    const names = await collectProjectNames({ projectRoot: root });
    expect(names).toContain("widget-api-worktrees");
    expect(names).toContain("widget-api");
  });

  it("ディレクトリ以外は拾わない", async () => {
    const names = await collectProjectNames({ projectRoot: root });
    expect(names).not.toContain("stray-file.txt");
  });

  it("置き場が存在しなくても落ちない", async () => {
    const names = await collectProjectNames({ projectRoot: path.join(root, "does-not-exist") });
    expect(names).toEqual([]);
  });

  it("実置き場を走査しても designdiff 自身は候補から外れる", async () => {
    const hits = await detectForeignProjectNames("designdiff の話だけ", { projectRoot: root });
    expect(hits).toEqual([]);
  });
});

describe("formatForeignProjectError", () => {
  it("検出語と直し方を含む", () => {
    const message = formatForeignProjectError(["acme-inc"]);
    expect(message).toContain("acme-inc");
    expect(message).toContain("起票を中止");
    expect(message).toContain("書き換えてから再実行");
  });
});
