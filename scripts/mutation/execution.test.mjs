import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { aggregate } from "./checkpoint.mjs";
import { executeStage, runStages } from "./coordinator.mjs";
import { evidence, identity } from "./evidence.mjs";
import { CheckpointReporter } from "./reporter.mjs";

function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), "hero-mutation-contract-"));
  const put = (name, value) => {
    const path = resolve(root, name);
    mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(
      path,
      typeof value === "string" ? value : JSON.stringify(value),
    );
  };
  execFileSync("git", ["init", "-q"], { cwd: root });
  put(".gitignore", "reports/\n");
  put("apps/discord-bot/src/helper.ts", "export const n = 1;");
  put(
    "apps/discord-bot/src/value.ts",
    'import { n } from "./helper.js"; export const value = () => n + 1;',
  );
  put(
    "apps/discord-bot/test/value.test.ts",
    'import { value } from "../src/value.ts";',
  );
  const mutant = {
    file: "src/value.ts",
    location: { start: { line: 0, column: 1 }, end: { line: 0, column: 2 } },
    mutatorName: "ArithmeticOperator",
    replacement: "n - 1",
  };
  const plan = () => ({
    plan: "Run",
    mutant: {
      ...mutant,
      fileName: resolve(root, "apps/discord-bot/src/value.ts"),
      id: "7",
      static: false,
    },
    runOptions: { testFilter: ["test/value.test.ts#behavior"] },
  });
  return {
    root,
    put,
    mutant,
    plan,
    clean: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("evidence survives docs/unrelated source changes, invalidates dependencies, tests and static inputs", () => {
  const f = fixture();
  try {
    const stamp = (m = f.mutant) =>
      evidence(f.root, "unit")(m, ["test/value.test.ts#behavior"]);
    const original = stamp();
    const staticStamp = stamp({ ...f.mutant, static: true });
    f.put("README.md", "new documentation");
    assert.equal(stamp(), original);
    f.put("apps/discord-bot/src/unrelated.ts", "export const other = 42;");
    assert.equal(stamp(), original);
    assert.notEqual(stamp({ ...f.mutant, static: true }), staticStamp);
    f.put("apps/discord-bot/src/helper.ts", "export const n = 2;");
    assert.notEqual(stamp(), original);
    const changedDependency = stamp();
    f.put("apps/discord-bot/.env", "HERO_ENV=production");
    assert.notEqual(stamp(), changedDependency);
    const changedEnvironment = stamp();
    f.put("apps/discord-bot/vitest.mutation.config.ts", "export default {};");
    assert.notEqual(stamp(), changedEnvironment);
    f.put(
      "apps/discord-bot/test/value.test.ts",
      'import { value } from "../src/value.ts"; // new assertion',
    );
    assert.notEqual(stamp(), changedDependency);
    assert.notEqual(
      evidence(f.root, "integration")(f.mutant, [
        "test/value.test.ts#behavior",
      ]),
      stamp(),
    );
  } finally {
    f.clean();
  }
});

test("reporter checkpoints finished outcomes, restores equivalent identities and gates integration", () => {
  const f = fixture();
  const previous = process.env.HERO_MUTATION_OPTIONS;
  try {
    const options = {
      root: f.root,
      stage: "unit",
      reuse: true,
      checkpoint: resolve(f.root, "checkpoint.json"),
      progress: resolve(f.root, "progress.json"),
    };
    f.put("options.json", options);
    process.env.HERO_MUTATION_OPTIONS = resolve(f.root, "options.json");
    const first = new CheckpointReporter();
    first.onMutationTestingPlanReady({ mutantPlans: [f.plan()] });
    first.onMutantTested({ id: "7", status: "Killed" });
    first.wrapUp();
    const second = new CheckpointReporter();
    const restored = f.plan();
    restored.mutant.id = "99";
    second.onMutationTestingPlanReady({ mutantPlans: [restored] });
    assert.equal(restored.plan, "EarlyResult");
    assert.equal(restored.mutant.status, "Killed");
    assert.equal(second.reused, 1);
    f.put("options.json", { ...options, reuse: false });
    const fresh = f.plan();
    new CheckpointReporter().onMutationTestingPlanReady({
      mutantPlans: [fresh],
    });
    assert.equal(fresh.plan, "Run");
    f.put("options.json", options);
    f.put("apps/discord-bot/src/helper.ts", "export const n = 2;");
    const stale = f.plan();
    new CheckpointReporter().onMutationTestingPlanReady({
      mutantPlans: [stale],
    });
    assert.equal(stale.plan, "Run");
    f.put("options.json", { ...options, stage: "integration", gate: [] });
    const gated = f.plan();
    new CheckpointReporter().onMutationTestingPlanReady({
      mutantPlans: [gated],
    });
    assert.equal(gated.plan, "EarlyResult");
    assert.equal(gated.mutant.status, "Ignored");
    assert.equal(
      identity(f.mutant),
      identity({ ...f.mutant, id: "different" }),
    );
  } finally {
    if (previous === undefined) delete process.env.HERO_MUTATION_OPTIONS;
    else process.env.HERO_MUTATION_OPTIONS = previous;
    f.clean();
  }
});

test("aggregate requires integration evidence for survivors and refuses unfinished/error results", () => {
  const unit = [
    { key: "a", status: "Killed" },
    { key: "b", status: "Survived" },
    { key: "c", status: "NoCoverage" },
  ];
  assert.equal(aggregate(unit, []).pending, 2);
  assert.deepEqual(
    aggregate(unit, [
      { key: "b", status: "Killed" },
      { key: "c", status: "NoCoverage" },
    ]),
    {
      complete: true,
      mutants: 3,
      pending: 0,
      statuses: { Killed: 2, NoCoverage: 1 },
    },
  );
  assert.equal(
    aggregate([{ key: "a", status: "RuntimeError" }], []).complete,
    true,
  );
});

test("coordinator gates integration, reports interrupted work, and does not launch empty scopes", async () => {
  const f = fixture();
  try {
    const calls = [];
    const plan = {
      base: "fixture",
      scope: "changed",
      mutate: ["src/value.ts:1:0-1:80"],
    };
    const execute = async (options) => {
      calls.push(options.stage);
      if (options.stage === "integration")
        assert.deepEqual(options.gate, ["b"]);
      f.put(options.progress, {
        planned: true,
        mutants:
          options.stage === "unit"
            ? [
                { key: "a", status: "Killed" },
                { key: "b", status: "Survived" },
              ]
            : [{ key: "b", status: "Killed" }],
      });
      return { code: 0, timedOut: false };
    };
    assert.equal(
      (await runStages(f.root, plan, { budget: 10 }, execute)).complete,
      true,
    );
    assert.deepEqual(calls, ["unit", "integration"]);
    const interrupted = await runStages(
      f.root,
      plan,
      { budget: 10 },
      async (options) => {
        f.put(options.progress, {
          planned: true,
          mutants: [{ key: "a", status: "Pending" }],
        });
        return { code: null, timedOut: true };
      },
    );
    assert.equal(interrupted.outcome, "incomplete");
    assert.equal(interrupted.pending, 1);
    const empty = await runStages(
      f.root,
      { ...plan, mutate: [] },
      { budget: 10 },
      () => assert.fail("empty scope launched a worker"),
    );
    assert.equal(empty.complete, true);
    assert.equal(
      JSON.parse(
        readFileSync(
          resolve(f.root, "apps/discord-bot/reports/mutation/summary.json"),
        ),
      ).complete,
      true,
    );
  } finally {
    f.clean();
  }
});

test("native Vitest discovery partitions the suite and defers only the three subprocess files", () => {
  const app = resolve("apps/discord-bot");
  const discover = (stage) =>
    execFileSync(
      process.execPath,
      [
        resolve(app, "node_modules/vitest/vitest.mjs"),
        "list",
        "--filesOnly",
        ...(stage ? ["--config", "vitest.mutation.config.ts"] : []),
      ],
      {
        cwd: app,
        env: { ...process.env, HERO_MUTATION_STAGE: stage ?? "" },
        encoding: "utf8",
      },
    )
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("test/"));
  const unit = discover("unit");
  const integration = discover("integration");
  const all = discover();
  const deferred = [
    "test/process.test.ts",
    "test/intake-process.test.ts",
    "test/evaluation.test.ts",
  ];
  assert.ok(unit.length > 0);
  assert.ok(integration.length > 0);
  assert.equal(unit.filter((file) => integration.includes(file)).length, 0);
  assert.deepEqual([...unit, ...integration, ...deferred].sort(), all.sort());
});

test("worker deadline terminates the process group and preserves prior progress", async () => {
  const f = fixture();
  try {
    f.put(
      "worker.mjs",
      `import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
// Fixtures must not publish their synthetic summaries to a real Actions run.
delete process.env.GITHUB_STEP_SUMMARY;

const options = JSON.parse(readFileSync(process.env.HERO_MUTATION_OPTIONS));
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
writeFileSync(options.progress, JSON.stringify({ pid: process.pid, child: child.pid }));
setInterval(() => {}, 1000);
`,
    );
    const result = await executeStage(
      {
        root: f.root,
        directory: f.root,
        progress: resolve(f.root, "progress.json"),
      },
      300,
      resolve(f.root, "worker.mjs"),
    );
    assert.equal(result.timedOut, true);
    const progress = JSON.parse(readFileSync(resolve(f.root, "progress.json")));
    assert.throws(() => process.kill(progress.pid, 0), { code: "ESRCH" });
    // Linux may briefly retain an orphaned zombie until init reaps it.
    try {
      const state = readFileSync(`/proc/${progress.child}/stat`, "utf8").split(
        ") ",
      )[1][0];
      assert.equal(state, "Z");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  } finally {
    f.clean();
  }
});

test("combined coverage retains a unit survivor when integration has no coverage", () => {
  assert.deepEqual(
    aggregate(
      [{ key: "covered", status: "Survived" }],
      [{ key: "covered", status: "NoCoverage" }],
    ),
    { complete: true, mutants: 1, pending: 0, statuses: { Survived: 1 } },
  );
});

test("a failed worker remains an analysis error rather than an invalid mutant", async () => {
  const f = fixture();
  const previous = process.exitCode;
  try {
    const summary = await runStages(
      f.root,
      { base: "fixture", scope: "all", mutate: ["src/value.ts:1:0-1:80"] },
      { budget: 10 },
      async () => ({ code: 1, timedOut: false }),
    );
    assert.equal(summary.outcome, "error");
    assert.equal(summary.complete, false);
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = previous;
    f.clean();
  }
});
