import { ipcMain } from "electron";

import { getTelemetryConsent, setTelemetryConsent, trackTelemetryEventUnsafe } from "../telemetry";

export const registerTelemetryHandlers = (): void => {
  ipcMain.handle("telemetry:get-consent", () => {
    return getTelemetryConsent();
  });

  ipcMain.handle("telemetry:set-consent", (_event, consent: boolean) => {
    setTelemetryConsent(consent === true);
  });

  // 引数は renderer 由来なので信用しない。許可リスト検証 (Zod) はここ、main 側でやる。
  ipcMain.handle("telemetry:track", (_event, name: unknown, properties: unknown) => {
    if (typeof name !== "string") return false;
    return trackTelemetryEventUnsafe(name, properties);
  });
};
