import { spawnSync } from "node:child_process";

if (!process.env.CI) {
  const result = spawnSync("make", ["--no-print-directory", "configure"], {
    cwd: new URL("../..", import.meta.url),
    stdio: "inherit",
  });
  if (result.error || result.status !== 0)
    console.warn(
      "Worktree configuration failed; dependency installation continues. Retry make install after resolving setup diagnostics.",
    );
}
