import { spawnSync } from "node:child_process";

if (!process.env.CI) {
  const result = spawnSync(
    process.execPath,
    [new URL("./cli.mjs", import.meta.url).pathname, "configure"],
    { stdio: "inherit" },
  );
  if (result.error || result.status !== 0)
    console.warn(
      "Worktree configuration failed; dependency installation continues. Retry make install after resolving setup diagnostics.",
    );
}
