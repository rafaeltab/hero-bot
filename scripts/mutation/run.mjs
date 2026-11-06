import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    base: { type: "string" },
    workspace: { type: "string", default: process.cwd() },
    plan: { type: "boolean", default: false },
    selection: { type: "string", default: "full-suite" },
    incremental: { type: "boolean", default: false },
  },
});
if (!values.base)
  throw new Error(
    "--base <commit/ref> is required; no implicit comparison base",
  );
if (!["full-suite", "per-test"].includes(values.selection))
  throw new Error("Unknown test selection");
if (values.incremental && values.selection !== "per-test")
  throw new Error(
    "Cache reuse requires per-test test-file tracking; full-suite always runs fresh",
  );
const root = resolve(values.workspace);
const git = (...args) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
const base = git("rev-parse", "--verify", `${values.base}^{commit}`).trim();
const app = resolve(root, "apps/discord-bot");
const paths = new Set([
  ...git("diff", "--name-only", "-z", base, "--", "apps/discord-bot/src").split(
    "\0",
  ),
  ...git(
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    "apps/discord-bot/src",
  ).split("\0"),
]);
const mutate = [];
for (const name of [...paths].sort()) {
  if (
    !name.endsWith(".ts") ||
    name.endsWith(".d.ts") ||
    /\/(generated|__generated__|test|__tests__)\/|\.(test|spec)\.ts$/.test(name)
  )
    continue;
  let source;
  try {
    source = readFileSync(resolve(root, name), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") continue;
    throw error;
  }
  const lines = source.split("\n");
  let before;
  try {
    before = git("show", `${base}:${name}`);
  } catch {
    before = undefined;
  }
  // Git's zero-context added/replaced ranges; deletions have no current code to mutate.
  const hunks =
    before === undefined
      ? [[1, lines.at(-1) === "" ? lines.length - 1 : lines.length]]
      : [
          ...git(
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--unified=0",
            base,
            "--",
            name,
          ).matchAll(/^@@ .* \+(\d+)(?:,(\d+))? @@/gm),
        ].map((match) => [Number(match[1]), Number(match[2] ?? 1)]);
  for (const [start, count] of hunks) {
    if (count > 0) {
      const end = start + count - 1;
      mutate.push(
        `${name.slice("apps/discord-bot/".length)}:${start}:0-${end}:${lines[end - 1].length}`,
      );
    }
  }
}
const plan = {
  base,
  comparison:
    "exact base tree to current working tree (tracked plus untracked)",
  mutate,
  selection: values.selection,
  incremental: values.incremental,
};
if (values.plan) {
  console.log(JSON.stringify(plan));
} else {
  process.chdir(app);
  mkdirSync("reports/mutation", { recursive: true });
  writeFileSync("reports/mutation/plan.json", JSON.stringify(plan, null, 2));
  // Remove stale results even when this scope has no instrumentable production code.
  rmSync("reports/mutation/index.html", { force: true });
  rmSync("reports/mutation/mutation.json", { force: true });
  if (mutate.length === 0) {
    writeFileSync(
      "reports/mutation/mutation.json",
      JSON.stringify({ files: {}, noMutations: true, plan }),
    );
    console.log(
      "No added/replaced production lines; see reports/mutation/plan.json",
    );
  } else {
    const { Stryker } = await import("@stryker-mutator/core");
    const perTest = values.selection === "per-test";
    // Invalidate even static results when any repository input changes. Stryker's
    // per-test cache alone cannot track test dependencies for static initialization.
    const hash = createHash("sha256").update(
      JSON.stringify({
        base,
        mutate,
        selection: values.selection,
        node: process.version,
        stryker: "10.1.1",
      }),
    );
    const inputs = new Set(
      git("ls-files", "--cached", "--others", "--exclude-standard", "-z")
        .split("\0")
        .filter(Boolean),
    );
    for (const name of [...inputs].sort()) {
      hash.update(name).update("\0");
      try {
        const input = resolve(root, name);
        hash.update(
          lstatSync(input).isSymbolicLink()
            ? readlinkSync(input)
            : readFileSync(input),
        );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        hash.update("<deleted>");
      }
      hash.update("\0");
    }
    const cacheKey = hash.digest("hex").slice(0, 16);
    await new Stryker({
      mutate,
      testRunner: perTest ? "vitest" : "command",
      plugins: perTest ? ["@stryker-mutator/vitest-runner"] : [],
      ...(perTest
        ? { vitest: { configFile: "vitest.config.ts", related: false } }
        : {}),
      // The full suite rebuilds instrumented TS for subprocess integration tests.
      commandRunner: { command: "pnpm build && pnpm test" },
      coverageAnalysis: perTest ? "perTest" : "off",
      ignoreStatic: false,
      incremental: values.incremental,
      incrementalFile: `reports/mutation/cache-${cacheKey}.json`,
      reporters: ["clear-text", "json", "html"],
      jsonReporter: { fileName: "reports/mutation/mutation.json" },
      htmlReporter: { fileName: "reports/mutation/index.html" },
      thresholds: { high: 80, low: 60, break: 0 },
      concurrency: 1,
      timeoutMS: 10000,
      timeoutFactor: 2,
      cleanTempDir: "always",
      disableBail: true,
    }).runMutationTest();
  }
}
