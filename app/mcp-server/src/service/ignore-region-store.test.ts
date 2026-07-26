import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:fs", () => ({
  constants: { F_OK: 0 },
  existsSync: vi.fn(),
}));
vi.mock("node:fs/promises");

const mockNodeFs = await import("node:fs");
const mockFs = await import("node:fs/promises");

function makeEnoentError(): NodeJS.ErrnoException {
  return Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" });
}

describe("ignore-region-store", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("missing YAML returns empty regions", async () => {
    vi.mocked(mockFs.readFile).mockRejectedValue(makeEnoentError());

    const { getIgnoreRegionConfig, getIgnoreRegions } = await import("./ignore-region-store.js");

    await expect(getIgnoreRegionConfig("project-1")).resolves.toEqual([]);
    await expect(getIgnoreRegions("project-1", "Home")).resolves.toEqual([]);
  });

  it("filters global and frame-specific entries", async () => {
    vi.mocked(mockFs.readFile).mockResolvedValue(`version: 1
regions:
  - id: global-map
    label: Global map
    x: 0
    y: 0
    width: 10
    height: 20
  - id: home-copy
    frame_name: Home
    x: 30
    y: 40
    width: 50
    height: 60
  - id: about-copy
    frame_name: About
    x: 70
    y: 80
    width: 90
    height: 100
`);

    const { getIgnoreRegionConfig, getIgnoreRegions } = await import("./ignore-region-store.js");

    const entries = await getIgnoreRegionConfig("project-1", "Home");
    expect(entries.map((entry) => entry.id)).toEqual(["global-map", "home-copy"]);

    const regions = await getIgnoreRegions("project-1", "Home");
    expect(regions).toEqual([
      { x: 0, y: 0, width: 10, height: 20, label: "Global map" },
      { x: 30, y: 40, width: 50, height: 60, label: undefined },
    ]);
  });

  it("comparison lookup without frame only applies global entries", async () => {
    vi.mocked(mockFs.readFile).mockResolvedValue(`version: 1
regions:
  - id: global-map
    x: 0
    y: 0
    width: 10
    height: 20
  - id: home-copy
    frame_name: Home
    x: 30
    y: 40
    width: 50
    height: 60
`);

    const { getIgnoreRegionsForComparison } = await import("./ignore-region-store.js");

    await expect(getIgnoreRegionsForComparison("project-1")).resolves.toEqual([
      { x: 0, y: 0, width: 10, height: 20, label: undefined },
    ]);
    await expect(getIgnoreRegionsForComparison("project-1", "Home")).resolves.toHaveLength(2);
  });

  it("invalid schema fails with project path and Zod issue summary", async () => {
    vi.mocked(mockFs.readFile).mockResolvedValue(`version: 1
regions:
  - id: invalid
    x: 0
    y: 0
    width: -1
    height: 10
    extra: nope
`);

    const { getIgnoreRegionConfig } = await import("./ignore-region-store.js");

    await expect(getIgnoreRegionConfig("project-1")).rejects.toThrow(
      /Invalid ignore-region YAML for project project-1.*regions\.0\.width.*regions\.0: Unrecognized key/,
    );
  });

  it("setIgnoreRegionConfig writes temp file then atomically renames", async () => {
    vi.mocked(mockFs.readFile).mockRejectedValue(makeEnoentError());
    vi.mocked(mockFs.mkdir).mockResolvedValue(undefined);
    vi.mocked(mockFs.writeFile).mockResolvedValue(undefined);
    vi.mocked(mockFs.rename).mockResolvedValue(undefined);

    const { setIgnoreRegionConfig } = await import("./ignore-region-store.js");

    await setIgnoreRegionConfig("project-1", [
      { id: "home-copy", frame_name: "Home", x: 1, y: 2, width: 3, height: 4 },
    ]);

    const writePath = String(vi.mocked(mockFs.writeFile).mock.calls[0][0]);
    const renameFrom = String(vi.mocked(mockFs.rename).mock.calls[0][0]);
    const renameTo = String(vi.mocked(mockFs.rename).mock.calls[0][1]);

    expect(writePath).toContain(".ignore-regions.yaml.");
    expect(renameFrom).toBe(writePath);
    expect(renameTo).toMatch(/ignore-regions\.yaml$/);
    expect(renameFrom.split("/").slice(0, -1)).toEqual(renameTo.split("/").slice(0, -1));
  });

  it("setIgnoreRegionConfig upsert-merges regions by id", async () => {
    vi.mocked(mockFs.readFile).mockResolvedValue(`version: 1
regions:
  - id: existing
    label: Old label
    x: 1
    y: 2
    width: 3
    height: 4
  - id: keep
    x: 5
    y: 6
    width: 7
    height: 8
`);
    vi.mocked(mockFs.mkdir).mockResolvedValue(undefined);
    vi.mocked(mockFs.writeFile).mockResolvedValue(undefined);
    vi.mocked(mockFs.rename).mockResolvedValue(undefined);

    const { setIgnoreRegionConfig } = await import("./ignore-region-store.js");

    const config = await setIgnoreRegionConfig("project-1", [
      { id: "existing", label: "New label", x: 10, y: 20, width: 30, height: 40 },
      { id: "new", x: 50, y: 60, width: 70, height: 80 },
    ]);

    expect(config.regions).toEqual([
      { id: "existing", label: "New label", x: 10, y: 20, width: 30, height: 40 },
      { id: "keep", x: 5, y: 6, width: 7, height: 8 },
      { id: "new", x: 50, y: 60, width: 70, height: 80 },
    ]);
  });

  it("deleteIgnoreRegion returns empty config without writing when project config is absent", async () => {
    vi.mocked(mockNodeFs.existsSync).mockReturnValue(false);

    const { deleteIgnoreRegion } = await import("./ignore-region-store.js");

    await expect(deleteIgnoreRegion("ghost", "r1")).resolves.toEqual({ version: 1, regions: [] });
    expect(vi.mocked(mockFs.readFile)).not.toHaveBeenCalled();
    expect(vi.mocked(mockFs.mkdir)).not.toHaveBeenCalled();
    expect(vi.mocked(mockFs.writeFile)).not.toHaveBeenCalled();
    expect(vi.mocked(mockFs.rename)).not.toHaveBeenCalled();
  });

  it("deleteIgnoreRegion removes the matching region and writes the remaining regions", async () => {
    vi.mocked(mockNodeFs.existsSync).mockReturnValue(true);
    vi.mocked(mockFs.readFile).mockResolvedValue(`version: 1
regions:
  - id: r1
    x: 1
    y: 2
    width: 3
    height: 4
  - id: r2
    x: 5
    y: 6
    width: 7
    height: 8
`);
    vi.mocked(mockFs.mkdir).mockResolvedValue(undefined);
    vi.mocked(mockFs.writeFile).mockResolvedValue(undefined);
    vi.mocked(mockFs.rename).mockResolvedValue(undefined);

    const { deleteIgnoreRegion } = await import("./ignore-region-store.js");

    const config = await deleteIgnoreRegion("project-1", "r1");

    expect(config.regions.map((region) => region.id)).toEqual(["r2"]);
    expect(vi.mocked(mockFs.writeFile)).toHaveBeenCalledOnce();
    expect(String(vi.mocked(mockFs.writeFile).mock.calls[0][1])).toContain("id: r2");
    expect(String(vi.mocked(mockFs.writeFile).mock.calls[0][1])).not.toContain("id: r1");
  });

  it("deleteIgnoreRegion keeps existing regions when the id is unknown", async () => {
    vi.mocked(mockNodeFs.existsSync).mockReturnValue(true);
    vi.mocked(mockFs.readFile).mockResolvedValue(`version: 1
regions:
  - id: r1
    x: 1
    y: 2
    width: 3
    height: 4
`);
    vi.mocked(mockFs.mkdir).mockResolvedValue(undefined);
    vi.mocked(mockFs.writeFile).mockResolvedValue(undefined);
    vi.mocked(mockFs.rename).mockResolvedValue(undefined);

    const { deleteIgnoreRegion } = await import("./ignore-region-store.js");

    const config = await deleteIgnoreRegion("project-1", "unknown");

    expect(config.regions.map((region) => region.id)).toEqual(["r1"]);
    expect(vi.mocked(mockFs.writeFile)).toHaveBeenCalledOnce();
    expect(String(vi.mocked(mockFs.writeFile).mock.calls[0][1])).toContain("id: r1");
  });

  it("write failure removes temp file", async () => {
    const error = new Error("disk full");
    vi.mocked(mockFs.readFile).mockRejectedValue(makeEnoentError());
    vi.mocked(mockFs.mkdir).mockResolvedValue(undefined);
    vi.mocked(mockFs.writeFile).mockRejectedValue(error);
    vi.mocked(mockFs.rm).mockResolvedValue(undefined);

    const { setIgnoreRegionConfig } = await import("./ignore-region-store.js");

    await expect(
      setIgnoreRegionConfig("project-1", [
        { id: "home-copy", frame_name: "Home", x: 1, y: 2, width: 3, height: 4 },
      ]),
    ).rejects.toThrow("disk full");

    const writePath = String(vi.mocked(mockFs.writeFile).mock.calls[0][0]);
    expect(vi.mocked(mockFs.rm)).toHaveBeenCalledWith(writePath, { force: true });
  });
});

describe("フレーム名の正規化", () => {
  let normalizeFrameName: (name: string) => string;

  beforeEach(async () => {
    ({ normalizeFrameName } = await import("./ignore-region-store.js"));
  });

  it("大文字小文字が違ってもヒットする", () => {
    expect(normalizeFrameName("Home Page")).toBe(normalizeFrameName("home page"));
  });

  it("前後の空白は無視する", () => {
    expect(normalizeFrameName("  Home  ")).toBe(normalizeFrameName("Home"));
  });

  it("全角空白と半角空白を同じ扱いにする", () => {
    expect(normalizeFrameName("Home　Page")).toBe(normalizeFrameName("Home Page"));
  });

  it("連続した空白を1つにまとめる", () => {
    expect(normalizeFrameName("Home   Page")).toBe(normalizeFrameName("Home Page"));
  });

  it("全角英数を半角に揃える", () => {
    expect(normalizeFrameName("ＨＯＭＥ")).toBe(normalizeFrameName("home"));
  });

  it("別のフレーム名は別のままにする", () => {
    expect(normalizeFrameName("Home")).not.toBe(normalizeFrameName("About"));
  });
});
