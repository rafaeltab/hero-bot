import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { applicationRoot } from "../production-policy.mjs";
import { cacheKey, projectFingerprint } from "./cache.mjs";

export async function runMutation(root, plan) {
  const fingerprint = projectFingerprint(root);
  const key = cacheKey(plan, fingerprint);
  process.chdir(resolve(root, applicationRoot));
  const directory = plan.shard
    ? `reports/mutation/shard-${plan.shard.index}-of-${plan.shard.count}`
    : "reports/mutation";
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    `${directory}/plan.json`,
    JSON.stringify({ ...plan, fingerprint }, null, 2),
  );
  rmSync(`${directory}/index.html`, { force: true });
  rmSync(`${directory}/mutation.json`, { force: true });
  rmSync(`${directory}/completed.json`, { force: true });
  const complete = () =>
    writeFileSync(
      `${directory}/completed.json`,
      JSON.stringify({
        fingerprint,
        reportHash: createHash("sha256")
          .update(readFileSync(`${directory}/mutation.json`))
          .digest("hex"),
      }),
    );
  if (!plan.mutate.length) {
    writeFileSync(
      `${directory}/mutation.json`,
      JSON.stringify({ files: {}, noMutations: true }),
    );
    console.log(
      `No added/replaced production lines; see ${directory}/plan.json`,
    );
    complete();
    return;
  }
  const { Stryker } = await import("@stryker-mutator/core");
  const perTest = plan.selection === "per-test";
  await new Stryker({
    mutate: plan.mutate,
    testRunner: perTest ? "vitest" : "command",
    plugins: perTest ? ["@stryker-mutator/vitest-runner"] : [],
    ...(perTest
      ? { vitest: { configFile: "vitest.config.ts", related: false } }
      : {}),
    // The full suite rebuilds instrumented TS for subprocess integration tests.
    commandRunner: { command: "pnpm build && pnpm test" },
    coverageAnalysis: perTest ? "perTest" : "off",
    ignoreStatic: false,
    incremental: plan.incremental,
    incrementalFile: `${directory}/cache-${key}.json`,
    reporters: ["clear-text", "json", "html"],
    jsonReporter: { fileName: `${directory}/mutation.json` },
    htmlReporter: { fileName: `${directory}/index.html` },
    thresholds: { high: 80, low: 60, break: 0 },
    concurrency: 1,
    timeoutMS: 10000,
    timeoutFactor: 2,
    cleanTempDir: "always",
    disableBail: true,
  }).runMutationTest();
  complete();
}
