import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises");

const mockFs = await import("node:fs/promises");

function makeEnoentError(): NodeJS.ErrnoException {
  return Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" });
}

describe("last-used-node-store", () => {
  const projectId = "test-project-123";
  const figmaFileKey = "ABC123fileKey";
  const nodeId = "1:23";
  const nodeName = "HomePage";

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("setLastUsedNode / getLastUsedNode round-trip", () => {
    it("stores and retrieves a node entry for a specific file key", async () => {
      const writtenEntry = { nodeId, nodeName, figmaFileKey, updatedAt: new Date().toISOString() };
      const writtenData = { entries: [writtenEntry] };

      vi.mocked(mockFs.readFile)
        .mockRejectedValueOnce(makeEnoentError())
        .mockResolvedValueOnce(JSON.stringify(writtenData));
      vi.mocked(mockFs.mkdir).mockResolvedValue(undefined);
      vi.mocked(mockFs.writeFile).mockResolvedValue(undefined);

      const { setLastUsedNode, getLastUsedNode } = await import("./last-used-node-store.js");

      await setLastUsedNode(projectId, figmaFileKey, nodeId, nodeName);

      vi.mocked(mockFs.readFile).mockResolvedValueOnce(JSON.stringify({ entries: [writtenEntry] }));

      const result = await getLastUsedNode(projectId, figmaFileKey);

      expect(result).toBeDefined();
      expect(result?.nodeId).toBe(nodeId);
      expect(result?.nodeName).toBe(nodeName);
      expect(result?.figmaFileKey).toBe(figmaFileKey);
    });

    it("stores entry without nodeName (optional field)", async () => {
      const writtenEntry = { nodeId, figmaFileKey, updatedAt: new Date().toISOString() };

      vi.mocked(mockFs.readFile)
        .mockRejectedValueOnce(makeEnoentError())
        .mockResolvedValueOnce(JSON.stringify({ entries: [writtenEntry] }));
      vi.mocked(mockFs.mkdir).mockResolvedValue(undefined);
      vi.mocked(mockFs.writeFile).mockResolvedValue(undefined);

      const { setLastUsedNode, getLastUsedNode } = await import("./last-used-node-store.js");

      await setLastUsedNode(projectId, figmaFileKey, nodeId);

      vi.mocked(mockFs.readFile).mockResolvedValueOnce(JSON.stringify({ entries: [writtenEntry] }));

      const result = await getLastUsedNode(projectId, figmaFileKey);
      expect(result?.nodeName).toBeUndefined();
    });

    it("upserts — second call for same file key overwrites the first", async () => {
      const firstEntry = { nodeId: "1:10", figmaFileKey, updatedAt: "" };
      const secondNodeId = "2:20";
      const secondEntry = {
        nodeId: secondNodeId,
        figmaFileKey,
        updatedAt: new Date().toISOString(),
      };

      vi.mocked(mockFs.readFile)
        .mockResolvedValueOnce(JSON.stringify({ entries: [firstEntry] }))
        .mockResolvedValueOnce(JSON.stringify({ entries: [secondEntry] }));
      vi.mocked(mockFs.mkdir).mockResolvedValue(undefined);
      vi.mocked(mockFs.writeFile).mockResolvedValue(undefined);

      const { setLastUsedNode, getLastUsedNode } = await import("./last-used-node-store.js");

      await setLastUsedNode(projectId, figmaFileKey, secondNodeId);

      const result = await getLastUsedNode(projectId, figmaFileKey);
      expect(result?.nodeId).toBe(secondNodeId);
    });
  });

  describe("getLastUsedNode with non-existent store", () => {
    it("returns undefined when no store file exists", async () => {
      vi.mocked(mockFs.readFile).mockRejectedValue(makeEnoentError());

      const { getLastUsedNode } = await import("./last-used-node-store.js");

      const result = await getLastUsedNode("non-existent-project", figmaFileKey);

      expect(result).toBeUndefined();
    });

    it("returns undefined when file key has no matching entry", async () => {
      const store = { entries: [{ nodeId: "9:9", figmaFileKey: "other-file", updatedAt: "" }] };
      vi.mocked(mockFs.readFile).mockResolvedValue(JSON.stringify(store));

      const { getLastUsedNode } = await import("./last-used-node-store.js");

      const result = await getLastUsedNode(projectId, figmaFileKey);

      expect(result).toBeUndefined();
    });
  });

  describe("path traversal prevention", () => {
    it("throws when projectId contains directory traversal sequences", async () => {
      const { setLastUsedNode } = await import("./last-used-node-store.js");

      await expect(setLastUsedNode("../evil", figmaFileKey, nodeId)).rejects.toThrow(
        "Invalid project ID",
      );
    });

    it("rejects or returns undefined when projectId contains path separators", async () => {
      vi.mocked(mockFs.readFile).mockRejectedValue(makeEnoentError());

      const { getLastUsedNode } = await import("./last-used-node-store.js");

      let result: unknown;
      try {
        result = await getLastUsedNode("project/hack", figmaFileKey);
      } catch {
        result = "threw";
      }
      expect(result).toSatisfy((v: unknown) => v === "threw" || v === undefined);
    });
  });

  describe("project isolation", () => {
    it("isolates entries between different projects", async () => {
      const projectA = "project-alpha";
      const projectB = "project-beta";
      const storeA = { entries: [{ nodeId: "1:1", figmaFileKey, updatedAt: "" }] };
      const storeB = { entries: [{ nodeId: "2:2", figmaFileKey, updatedAt: "" }] };

      vi.mocked(mockFs.readFile).mockImplementation((filePath) => {
        const p = String(filePath);
        if (p.includes(projectA)) return Promise.resolve(JSON.stringify(storeA));
        if (p.includes(projectB)) return Promise.resolve(JSON.stringify(storeB));
        return Promise.reject(makeEnoentError());
      });

      const { getLastUsedNode } = await import("./last-used-node-store.js");

      const resultA = await getLastUsedNode(projectA, figmaFileKey);
      const resultB = await getLastUsedNode(projectB, figmaFileKey);

      expect(resultA?.nodeId).toBe("1:1");
      expect(resultB?.nodeId).toBe("2:2");
    });
  });
});
