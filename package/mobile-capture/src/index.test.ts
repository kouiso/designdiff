import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { captureDeviceScreenshot, type CaptureDevice } from "./index.js";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

const mockedExecFile = vi.mocked(execFile);

type ExecCallback = (error: Error | null, stdout: Buffer, stderr: Buffer) => void;

async function createCaptureDir(): Promise<string> {
  return fs.mkdtemp(path.join(tmpdir(), "figdiff-mobile-capture-"));
}

afterEach(() => {
  mockedExecFile.mockReset();
});

describe("captureDeviceScreenshot", () => {
  it("captures android screenshots with adb exec-out screencap -p", async () => {
    mockedExecFile.mockImplementation((command, args, options, callback) => {
      expect(command).toBe("adb");
      expect(args).toEqual(["exec-out", "screencap", "-p"]);
      expect(options).toMatchObject({ encoding: "buffer" });
      (callback as ExecCallback)(null, Buffer.from("png"), Buffer.alloc(0));
      return {} as ReturnType<typeof execFile>;
    });

    const result = await captureDeviceScreenshot({ device: "android" });

    expect(result.startsWith(path.join(homedir(), ".figdiff", "cache", "capture"))).toBe(true);
    expect(path.basename(result)).toMatch(/^android-.*\.png$/);
    await expect(fs.readFile(result, "utf8")).resolves.toBe("png");
  });

  it.each([
    {
      device: "ios-sim" as CaptureDevice,
      command: "xcrun",
      argsPrefix: ["simctl", "io", "booted", "screenshot"],
    },
    {
      device: "ios-device" as CaptureDevice,
      command: "pymobiledevice3",
      argsPrefix: ["developer", "dvt", "screenshot"],
    },
  ])("captures $device screenshots with the expected command", async ({
    device,
    command,
    argsPrefix,
  }) => {
    const outputDir = await createCaptureDir();
    mockedExecFile.mockImplementation((actualCommand, args, callback) => {
      expect(actualCommand).toBe(command);
      expect(args).toHaveLength(argsPrefix.length + 1);
      expect(args?.slice(0, argsPrefix.length)).toEqual(argsPrefix);
      expect(typeof args?.[argsPrefix.length]).toBe("string");
      (callback as ExecCallback)(null, Buffer.alloc(0), Buffer.alloc(0));
      return {} as ReturnType<typeof execFile>;
    });

    const result = await captureDeviceScreenshot({ device, outputDir });

    expect(result.startsWith(outputDir)).toBe(true);
    expect(path.basename(result)).toMatch(new RegExp(`^${device}-.*\\.png$`));
    expect(mockedExecFile).toHaveBeenCalledTimes(1);
  });
});
