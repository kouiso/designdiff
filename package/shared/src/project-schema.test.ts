import { describe, expect, it } from "vitest";

import {
  CompareDesignResultSchema,
  CompletionCriteriaSchema,
  DesignSourceSchema,
  ProjectPageSchema,
  ProjectSchema,
} from "./schema.js";

describe("DesignSourceSchema", () => {
  it("figma type のデザインソースをパースできる", () => {
    const input = {
      type: "figma",
      id: "src-1",
      label: "PC版デザイン",
      figmaUrl: "https://www.figma.com/design/ABC/File?node-id=1-23",
      fileKey: "ABC",
      nodeId: "1:23",
    };
    const result = DesignSourceSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("figma");
    }
  });

  it("figma type で nodeId が省略可能", () => {
    const input = {
      type: "figma",
      id: "src-2",
      label: "SP版デザイン",
      figmaUrl: "https://www.figma.com/design/ABC/File",
      fileKey: "ABC",
    };
    const result = DesignSourceSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("local_image type のデザインソースをパースできる", () => {
    const input = {
      type: "local_image",
      id: "src-3",
      label: "修正前スクショ",
      filePath: "/path/to/image.png",
    };
    const result = DesignSourceSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("local_image");
    }
  });

  it("不正な type でバリデーションエラー", () => {
    const input = {
      type: "unknown",
      id: "src-4",
      label: "不正",
    };
    const result = DesignSourceSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("figma type で必須フィールドが欠けているとエラー", () => {
    const input = {
      type: "figma",
      id: "src-5",
      // label が欠落
      figmaUrl: "https://figma.com/design/ABC/File",
      fileKey: "ABC",
    };
    const result = DesignSourceSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

describe("ProjectPageSchema", () => {
  it("ページをパースできる", () => {
    const input = {
      id: "page-1",
      name: "ホーム",
      path: "/home",
      designSources: [
        {
          type: "figma",
          id: "src-1",
          label: "PC版",
          figmaUrl: "https://figma.com/design/ABC/File?node-id=1-23",
          fileKey: "ABC",
          nodeId: "1:23",
        },
      ],
    };
    const result = ProjectPageSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.designSources).toHaveLength(1);
    }
  });

  it("空のデザインソースでもパース可能", () => {
    const input = {
      id: "page-2",
      name: "About",
      path: "/about",
      designSources: [],
    };
    const result = ProjectPageSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("複数のデザインソースを持てる（PC + SP + ローカル画像）", () => {
    const input = {
      id: "page-3",
      name: "ホーム",
      path: "/home",
      designSources: [
        {
          type: "figma",
          id: "src-1",
          label: "PC版",
          figmaUrl: "https://figma.com/design/ABC/File?node-id=1-23",
          fileKey: "ABC",
        },
        {
          type: "figma",
          id: "src-2",
          label: "SP版",
          figmaUrl: "https://figma.com/design/ABC/File?node-id=2-34",
          fileKey: "ABC",
          nodeId: "2:34",
        },
        {
          type: "local_image",
          id: "src-3",
          label: "修正前",
          filePath: "/tmp/before.png",
        },
      ],
    };
    const result = ProjectPageSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.designSources).toHaveLength(3);
    }
  });
});

describe("ProjectSchema", () => {
  it("完全なプロジェクトをパースできる", () => {
    const input = {
      id: "proj-1",
      name: "コーポレートサイト",
      implementationUrl: "http://localhost:3000",
      pages: [
        {
          id: "page-1",
          name: "ホーム",
          path: "/home",
          designSources: [
            {
              type: "figma",
              id: "src-1",
              label: "PC版デザイン",
              figmaUrl: "https://figma.com/design/ABC/File?node-id=1-23",
              fileKey: "ABC",
              nodeId: "1:23",
            },
          ],
        },
      ],
      createdAt: "2026-03-28T12:00:00Z",
      updatedAt: "2026-03-28T12:00:00Z",
    };
    const result = ProjectSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.implementationUrl).toBe("http://localhost:3000");
      expect(result.data.pages).toHaveLength(1);
    }
  });

  it("ページなしのプロジェクトもパース可能", () => {
    const input = {
      id: "proj-2",
      name: "新規プロジェクト",
      implementationUrl: "http://localhost:8080",
      pages: [],
      createdAt: "2026-03-28T12:00:00Z",
      updatedAt: "2026-03-28T12:00:00Z",
    };
    const result = ProjectSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("implementationUrl が欠けているとエラー", () => {
    const input = {
      id: "proj-3",
      name: "不正プロジェクト",
      pages: [],
      createdAt: "2026-03-28T12:00:00Z",
      updatedAt: "2026-03-28T12:00:00Z",
    };
    const result = ProjectSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

describe("CompletionCriteriaSchema", () => {
  it("全 PASS の完了条件をパースできる", () => {
    const input = {
      matchRate: { required: 100, current: 100, status: "PASS" },
      diffPixelCount: { required: 0, current: 0, status: "PASS" },
      remainingIssues: { required: 0, current: 0, status: "PASS" },
    };
    const result = CompletionCriteriaSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("FAIL を含む完了条件をパースできる", () => {
    const input = {
      matchRate: { required: 100, current: 94.2, status: "FAIL" },
      diffPixelCount: { required: 0, current: 1847, status: "FAIL" },
      remainingIssues: { required: 0, current: 3, status: "FAIL" },
    };
    const result = CompletionCriteriaSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("不正な status でエラー", () => {
    const input = {
      matchRate: { required: 100, current: 94.2, status: "UNKNOWN" },
      diffPixelCount: { required: 0, current: 0, status: "PASS" },
      remainingIssues: { required: 0, current: 0, status: "PASS" },
    };
    const result = CompletionCriteriaSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

describe("CompareDesignResultSchema (v4 強化版)", () => {
  it("status と completionCriteria を含む結果をパースできる", () => {
    const input = {
      status: "FAIL",
      comparisonId: "cmp-1",
      matchRate: 94.2,
      diffPixelCount: 1847,
      totalPixelCount: 100000,
      remainingIssues: 3,
      diffRegions: [
        {
          id: 0,
          bounds: { x: 100, y: 50, width: 200, height: 30 },
          diffPixelCount: 800,
          nearbyNodeIds: ["1:45"],
          nearbyNodeNames: ["header"],
        },
      ],
      completionCriteria: {
        matchRate: { required: 100, current: 94.2, status: "FAIL" },
        diffPixelCount: { required: 0, current: 1847, status: "FAIL" },
        remainingIssues: { required: 0, current: 3, status: "FAIL" },
      },
      nextAction: "inspect_node を使って diffRegions の詳細を確認し、修正してください",
      suggestion: "差分が3箇所あります",
    };
    const result = CompareDesignResultSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("FAIL");
      expect(result.data.completionCriteria.matchRate.status).toBe("FAIL");
    }
  });

  it("status PASS で差分ゼロの結果をパースできる", () => {
    const input = {
      status: "PASS",
      comparisonId: "cmp-2",
      matchRate: 100,
      diffPixelCount: 0,
      totalPixelCount: 100000,
      remainingIssues: 0,
      diffRegions: [],
      completionCriteria: {
        matchRate: { required: 100, current: 100, status: "PASS" },
        diffPixelCount: { required: 0, current: 0, status: "PASS" },
        remainingIssues: { required: 0, current: 0, status: "PASS" },
      },
      nextAction: "一致率100%です。差分はありません。タスク完了です。",
      suggestion: "一致率100%です。差分はありません。",
    };
    const result = CompareDesignResultSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("PASS");
    }
  });

  it("後方互換: status/completionCriteria/nextAction/remainingIssues なしでもパス（optional）", () => {
    const input = {
      comparisonId: "cmp-3",
      matchRate: 90,
      diffPixelCount: 5000,
      totalPixelCount: 100000,
      diffRegions: [],
      suggestion: "差分があります",
    };
    const result = CompareDesignResultSchema.safeParse(input);
    expect(result.success).toBe(true);
  });
});
