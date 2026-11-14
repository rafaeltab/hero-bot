import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const options = JSON.parse(
  readFileSync(process.env.HERO_MUTATION_OPTIONS, "utf8"),
);
process.chdir(resolve(options.root, "apps/discord-bot"));
process.env.HERO_MUTATION_STAGE = options.stage;
const { Stryker } = await import("@stryker-mutator/core");
await new Stryker({
  mutate: options.mutate,
  dryRunOnly: options.dryRun,
  testRunner: "vitest",
  plugins: [
    "@stryker-mutator/vitest-runner",
    fileURLToPath(new URL("./reporter.mjs", import.meta.url)),
  ],
  vitest: { configFile: "vitest.mutation.config.ts", related: false },
  coverageAnalysis: "perTest",
  ignoreStatic: false,
  incremental: false, // Validated checkpoints are applied after fresh coverage discovery.
  reporters: ["clear-text", "json", "html", "checkpoint"],
  jsonReporter: { fileName: `${options.directory}/mutation.json` },
  htmlReporter: { fileName: `${options.directory}/index.html` },
  thresholds: { high: 80, low: 60, break: 0 },
  concurrency: 1,
  timeoutMS: 10000,
  timeoutFactor: 2,
  tempDirName: resolve(options.root, ".stryker-tmp"),
  cleanTempDir: "always",
  disableBail: false,
}).runMutationTest();
