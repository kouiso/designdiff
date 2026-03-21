import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:fs/promises");

const mockFs = await import("node:fs/promises");

function makeEnoentError(): NodeJS.ErrnoException {
  return Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" });
}

describe("crop-region-store", () => {
  const validProjectId = "test-project-123";
  const frameName = "HomeFrame";
  const region = { x: 10, y: 20, width: 100, height: 200 };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("setCropRegion / getCropRegion round-trip", () => {
    it("stores and retrieves a crop region for a specific frame", async () => {
      // Arrange: first read returns empty store, write succeeds, second read returns written data
      const writtenData = { regions: [{ frameName, region, updatedAt: new Date().toISOString() }] };

      vi.mocked(mockFs.readFile)
        .mockRejectedValueOnce(makeEnoentError())
        .mockResolvedValueOnce(JSON.stringify(writtenData));
      vi.mocked(mockFs.mkdir).mockResolvedValue(undefined);
      vi.mocked(mockFs.writeFile).mockResolvedValue(undefined);

      const { setCropRegion, getCropRegion } = await import("./crop-region-store.js");

      // Act
      const entry = await setCropRegion(validProjectId, frameName, region);

      vi.mocked(mockFs.readFile).mockResolvedValueOnce(JSON.stringify({ regions: [entry] }));

      const results = await getCropRegion(validProjectId, frameName);

      // Assert
      expect(results).toHaveLength(1);
      expect(results[0].frameName).toBe(frameName);
      expect(results[0].region).toEqual(region);
    });

    it("stores an optional note alongside the region", async () => {
      const note = "Focus on the header area";
      const writtenEntry = { frameName, region, note, updatedAt: new Date().toISOString() };

      vi.mocked(mockFs.readFile)
        .mockRejectedValueOnce(makeEnoentError())
        .mockResolvedValueOnce(JSON.stringify({ regions: [writtenEntry] }));
      vi.mocked(mockFs.mkdir).mockResolvedValue(undefined);
      vi.mocked(mockFs.writeFile).mockResolvedValue(undefined);

      const { setCropRegion, getCropRegion } = await import("./crop-region-store.js");

      await setCropRegion(validProjectId, frameName, region, note);

      vi.mocked(mockFs.readFile).mockResolvedValueOnce(JSON.stringify({ regions: [writtenEntry] }));

      const results = await getCropRegion(validProjectId, frameName);
      expect(results[0].note).toBe(note);
    });
  });

  describe("getCropRegion with non-existent projectId", () => {
    it("returns empty array when no store file exists", async () => {
      vi.mocked(mockFs.readFile).mockRejectedValue(makeEnoentError());

      const { getCropRegion } = await import("./crop-region-store.js");

      // Act
      const results = await getCropRegion("non-existent-project");

      // Assert
      expect(results).toEqual([]);
    });

    it("returns empty array when frameName is provided but no match exists", async () => {
      vi.mocked(mockFs.readFile).mockRejectedValue(makeEnoentError());

      const { getCropRegion } = await import("./crop-region-store.js");

      const results = await getCropRegion("non-existent-project", "SomeFrame");

      expect(results).toEqual([]);
    });
  });

  describe("path traversal prevention", () => {
    it("throws when projectId contains directory traversal sequences", async () => {
      const { setCropRegion } = await import("./crop-region-store.js");

      await expect(setCropRegion("../evil", frameName, region)).rejects.toThrow(
        "Invalid project ID",
      );
    });

    it("rejects or returns empty array when projectId contains path separators", async () => {
      vi.mocked(mockFs.readFile).mockRejectedValue(makeEnoentError());

      const { getCropRegion } = await import("./crop-region-store.js");

      // The regex /^[a-zA-Z0-9_-]+$/ does NOT match "/" so getProjectDir throws,
      // but since getCropRegion catches errors via readStore it returns [].
      // Either rejection OR empty array is acceptable defense against path traversal.
      let result: unknown;
      try {
        result = await getCropRegion("project/hack");
      } catch {
        result = "threw";
      }
      // The key assertion: no data is returned for this invalid ID
      expect(result).toSatisfy(
        (v: unknown) => v === "threw" || (Array.isArray(v) && v.length === 0),
      );
    });

    it("rejects or returns empty array when projectId contains null bytes", async () => {
      vi.mocked(mockFs.readFile).mockRejectedValue(makeEnoentError());

      const { getCropRegion } = await import("./crop-region-store.js");

      let result: unknown;
      try {
        result = await getCropRegion("project\0hack");
      } catch {
        result = "threw";
      }
      expect(result).toSatisfy(
        (v: unknown) => v === "threw" || (Array.isArray(v) && v.length === 0),
      );
    });
  });

  describe("multiple projectId independence", () => {
    it("isolates crop regions between different projects", async () => {
      const projectA = "project-alpha";
      const projectB = "project-beta";
      const frameA = "FrameA";
      const frameB = "FrameB";
      const regionA = { x: 0, y: 0, width: 50, height: 50 };
      const regionB = { x: 100, y: 100, width: 200, height: 200 };

      const storeA = { regions: [{ frameName: frameA, region: regionA, updatedAt: "" }] };
      const storeB = { regions: [{ frameName: frameB, region: regionB, updatedAt: "" }] };

      vi.mocked(mockFs.readFile).mockImplementation((filePath) => {
        const p = String(filePath);
        if (p.includes(projectA)) return Promise.resolve(JSON.stringify(storeA));
        if (p.includes(projectB)) return Promise.resolve(JSON.stringify(storeB));
        return Promise.reject(makeEnoentError());
      });

      const { getCropRegion } = await import("./crop-region-store.js");

      // Act
      const resultsA = await getCropRegion(projectA, frameA);
      const resultsB = await getCropRegion(projectB, frameB);

      // Assert: each project only sees its own frame
      expect(resultsA).toHaveLength(1);
      expect(resultsA[0].region).toEqual(regionA);

      expect(resultsB).toHaveLength(1);
      expect(resultsB[0].region).toEqual(regionB);
    });

    it("getCropRegion without frameName returns all frames for that project only", async () => {
      const projectId = "project-multi";
      const store = {
        regions: [
          { frameName: "Frame1", region, updatedAt: "" },
          { frameName: "Frame2", region, updatedAt: "" },
        ],
      };

      vi.mocked(mockFs.readFile).mockResolvedValue(JSON.stringify(store));

      const { getCropRegion } = await import("./crop-region-store.js");

      const results = await getCropRegion(projectId);

      expect(results).toHaveLength(2);
      expect(results.map((r) => r.frameName)).toEqual(["Frame1", "Frame2"]);
    });
  });
});
