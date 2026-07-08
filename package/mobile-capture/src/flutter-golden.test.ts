import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runFlutterGolden } from "./flutter-golden.js";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

const mockedExecFile = vi.mocked(execFile);

async function createFlutterProjectDir(): Promise<string> {
  return fs.mkdtemp(path.join(tmpdir(), "figdiff-flutter-golden-"));
}

async function writeGolden(projectDir: string, goldenRelativePath: string): Promise<void> {
  const goldenPath = path.join(projectDir, goldenRelativePath);
  await fs.mkdir(path.dirname(goldenPath), { recursive: true });
  await fs.writeFile(goldenPath, "png");
}

afterEach(() => {
  mockedExecFile.mockReset();
});

describe("runFlutterGolden", () => {
  it("runs flutter test --update-goldens and returns the absolute golden path", async () => {
    const projectDir = await createFlutterProjectDir();
    const goldenRelativePath = "test/widget/goldens/welcome_screen.png";
    await writeGolden(projectDir, goldenRelativePath);

    mockedExecFile.mockImplementation((command, args, options, callback) => {
      expect(command).toBe("flutter");
      expect(args).toEqual(["test", "--update-goldens", "test/widget_test.dart"]);
      expect(options).toMatchObject({ cwd: projectDir });
      callback(null, "", "");
      return undefined;
    });

    const result = await runFlutterGolden({
      testTarget: "test/widget_test.dart",
      flutterProjectDir: projectDir,
      goldenRelativePath,
    });

    expect(result).toBe(path.resolve(projectDir, goldenRelativePath));
    expect(mockedExecFile).toHaveBeenCalledTimes(1);
  });

  it("throws a clear error when the golden file is missing after the test run", async () => {
    const projectDir = await createFlutterProjectDir();
    const goldenRelativePath = "test/widget/goldens/missing.png";
    const expectedPath = path.resolve(projectDir, goldenRelativePath);

    mockedExecFile.mockImplementation((_command, _args, _options, callback) => {
      callback(null, "", "");
      return undefined;
    });

    await expect(
      runFlutterGolden({
        testTarget: "test/widget_test.dart",
        flutterProjectDir: projectDir,
        goldenRelativePath,
      }),
    ).rejects.toThrow(`Flutter golden PNG was not found after test run: ${expectedPath}`);
  });

  it("surfaces stderr when flutter test exits non-zero", async () => {
    const projectDir = await createFlutterProjectDir();

    mockedExecFile.mockImplementation((_command, _args, _options, callback) => {
      callback(new Error("Command failed"), "", "golden mismatch details");
      return undefined;
    });

    await expect(
      runFlutterGolden({
        testTarget: "test/widget_test.dart",
        flutterProjectDir: projectDir,
        goldenRelativePath: "test/widget/goldens/welcome_screen.png",
      }),
    ).rejects.toThrow("flutter test --update-goldens failed: golden mismatch details");
  });
});
