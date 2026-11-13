import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { checkCrap } from "./check-crap.mjs";
import { fingerprint, sealCoverage } from "./coverage-evidence.mjs";
import { loadTestEnvironment } from "./worktree/test-environment.mjs";

await loadTestEnvironment();

const root = process.cwd();
const app = resolve(root, "apps/discord-bot");
for (const directory of ["coverage", "coverage-crap"])
  await rm(resolve(app, directory), { recursive: true, force: true });
const started = Date.now();
const inputs = await fingerprint(root);
execFileSync("pnpm", ["exec", "turbo", "run", "coverage", "--force"], {
  stdio: "inherit",
});
execFileSync(process.execPath, ["scripts/check-coverage.mjs"], {
  stdio: "inherit",
});
execFileSync(
  "pnpm",
  ["exec", "vitest", "run", "--coverage", "--config", "vitest.crap.config.ts"],
  { cwd: app, stdio: "inherit" },
);
await sealCoverage(root, started, inputs);
await checkCrap(root);
