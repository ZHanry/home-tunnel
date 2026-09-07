import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const result = spawnSync(
  process.execPath,
  [
    "control-center/node_modules/eslint/bin/eslint.js",
    "--config",
    "eslint.browser.config.mjs",
    "linux-client/internal/gui/web/desktop.js",
  ],
  {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    stdio: "inherit",
  },
);
process.exitCode = result.status ?? 1;
