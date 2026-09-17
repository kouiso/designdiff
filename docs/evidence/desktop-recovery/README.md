# Desktop recovery feature evidence

These runs use the real Electron main process, preload, IPC and renderer. They verify synthetic inputs on Linux/WSL; they do not prove real Figma behavior, other OS/device routes, or the final campaign rounds.

- **Node fix:** the target pixel difference changes from 800 to 0 while another grid changes from 0 to 1600. The UI must show target improvement and retain the overall failure. Geometry and PNG use the same synthetic Figma version; crop and a half-target mask are applied.
- **Report export:** real OS save dialogs write JSON and Markdown. Both outputs are checked against 400 known different pixels and a 20×20 rectangle at (5, 5); cancel preserves the saved files. `report-response.raw.txt` contains the exact JSON response bytes, with its media type and hash recorded in the manifest.

`manifest.json` records the actual pre-final revision, dirty state, driver hash, complete relevant build inventory and selected artifact hashes. The two runs use the same build bytes, but ran before a final product commit. Runtime machine paths are omitted; screenshots and raw responses have not been edited.
