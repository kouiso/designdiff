import process from "node:process";

// manifest には再現用の起動コマンドと実ダイアログの toolkit 名を書く。
// xvfb-run は linux の無画面環境だけで runner が挟むもの
// (script/run-campaign-round.mjs)。xvfb-run は子にも DISPLAY を配るので
// driver 側では runner の marker FIGDIFF_VIA_XVFB で判定する。
export const manifestRunCommand = (envVar, scriptPath, placeholder = "<evidence>") =>
  process.platform === "win32"
    ? `$env:${envVar}="${placeholder}"; node ${scriptPath}`
    : process.platform === "linux" && process.env.FIGDIFF_VIA_XVFB === "1"
      ? `${envVar}=${placeholder} xvfb-run -a node ${scriptPath}`
      : `${envVar}=${placeholder} node ${scriptPath}`;

export const manifestDialogLabel = () =>
  process.platform === "win32"
    ? "実Win32保存ダイアログ"
    : process.platform === "darwin"
      ? "実NSSavePanel"
      : "実Gtk保存ダイアログ";
