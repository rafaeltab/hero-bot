import { spawnSync } from "node:child_process";
import { join } from "node:path";

if (!process.env.CI) {
  try {
    const { root, stateDir } = await import("./state.mjs");
    const result = spawnSync(
      "flock",
      [
        join(stateDir, "registry.lock"),
        process.execPath,
        "--input-type=module",
        "-e",
        'import { configure } from "./scripts/worktree/configure.mjs"; await configure();',
      ],
      { cwd: root, stdio: "inherit" },
    );
    if (result.error || result.status !== 0)
      throw Error("Configuration failed");
  } catch {
    console.warn(
      "Worktree configuration failed; dependency installation continues. Retry make install after resolving setup diagnostics.",
    );
  }
}
