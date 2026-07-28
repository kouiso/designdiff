import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 案件の保存は本物のファイルシステムで動かす。書き込みの途中で壊れないように
// 一時ファイルへ書いてから置き換える処理が本題なので、差し替えると意味が無い。
const mocks = vi.hoisted(() => ({ handle: vi.fn(), getPath: vi.fn() }));

vi.mock("electron", () => ({
  ipcMain: { handle: mocks.handle },
  app: { getPath: mocks.getPath },
}));

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const makeProject = (id: string, updatedAt = "2026-07-28T00:00:00.000Z") => ({
  id,
  name: `project ${id}`,
  implementationUrl: "https://example.test/",
  pages: [],
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt,
});

describe("registerProjectHandlers", () => {
  let homeDir: string;
  let handlers: Map<string, Handler>;

  beforeEach(async () => {
    homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "figdiff-projects-"));
    mocks.getPath.mockReturnValue(homeDir);
    mocks.handle.mockClear();
    vi.resetModules();

    const { registerProjectHandlers } = await import("./project.js");
    registerProjectHandlers();

    handlers = new Map();
    for (const [channel, handler] of mocks.handle.mock.calls) {
      if (typeof channel === "string" && typeof handler === "function") {
        handlers.set(channel, handler);
      }
    }
  });

  afterEach(async () => {
    await fs.promises.rm(homeDir, { recursive: true, force: true });
  });

  const invoke = (channel: string, ...args: unknown[]): unknown => {
    const handler = handlers.get(channel);
    if (!handler) {
      throw new Error(`handler not registered: ${channel}`);
    }
    return handler({}, ...args);
  };

  it("保存したものを読み出せること", () => {
    const project = makeProject("alpha");

    invoke("project:save", project);

    expect(invoke("project:load", "alpha")).toEqual(project);
  });

  it("一覧は更新の新しい順に返すこと", () => {
    invoke("project:save", makeProject("old", "2026-07-01T00:00:00.000Z"));
    invoke("project:save", makeProject("new", "2026-07-28T00:00:00.000Z"));

    const listed = invoke("project:list");

    expect(Array.isArray(listed)).toBe(true);
    if (Array.isArray(listed)) {
      expect(listed.map((entry) => entry.id)).toEqual(["new", "old"]);
    }
  });

  it("壊れた保存内容は一覧から外し、他を巻き込まないこと", () => {
    invoke("project:save", makeProject("good"));
    const brokenDir = path.join(homeDir, ".figdiff", "projects", "broken");
    fs.mkdirSync(brokenDir, { recursive: true });
    fs.writeFileSync(path.join(brokenDir, "project.json"), "{ not json", "utf-8");

    const listed = invoke("project:list");

    if (Array.isArray(listed)) {
      expect(listed.map((entry) => entry.id)).toEqual(["good"]);
    }
  });

  it("上の階層へ抜ける名前は弾くこと", () => {
    // 名前をそのままパスへ使うと、案件の置き場所の外へ書き込める。
    for (const badId of ["../escape", "a/b", "..", "with space", ""]) {
      expect(() => invoke("project:load", badId)).toThrow(/Invalid project ID/);
      expect(() => invoke("project:delete", badId)).toThrow(/Invalid project ID/);
    }
  });

  it("形の合わない保存内容は弾くこと", () => {
    expect(() => invoke("project:save", { id: "x" })).toThrow(/Invalid project data/);
  });

  it("名前が使えない案件は保存も弾くこと", () => {
    expect(() => invoke("project:save", makeProject("../escape"))).toThrow(/Invalid project ID/);
  });

  it("無い案件を読もうとしたら、その旨で終わること", () => {
    expect(() => invoke("project:load", "missing")).toThrow(/Project not found/);
  });

  it("中身が壊れている案件を読もうとしたら、その旨で終わること", () => {
    const dir = path.join(homeDir, ".figdiff", "projects", "broken");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify({ id: "broken" }), "utf-8");

    expect(() => invoke("project:load", "broken")).toThrow(/Invalid project data/);
  });

  it("消したら読めなくなること。無いものを消しても落ちないこと", () => {
    invoke("project:save", makeProject("gone"));

    invoke("project:delete", "gone");
    expect(() => invoke("project:load", "gone")).toThrow(/Project not found/);

    expect(() => invoke("project:delete", "gone")).not.toThrow();
  });

  it("保存のたびに一時ファイルを残さないこと", () => {
    invoke("project:save", makeProject("clean"));

    const dir = path.join(homeDir, ".figdiff", "projects", "clean");
    // 途中書き込みの破損を避けるため一時ファイルを経由する。消し忘れると溜まる。
    expect(fs.readdirSync(dir)).toEqual(["project.json"]);
  });
});
