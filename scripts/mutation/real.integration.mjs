import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const workspace = process.cwd();
const cli = resolve("scripts/mutation/run.mjs");

test("real native mutation execution, integration gating, checkpoints and dependency invalidation", {
  timeout: 180000,
}, () => {
  mkdirSync(".mutation-fixtures", { recursive: true });
  const root = mkdtempSync(resolve(".mutation-fixtures/real-"));
  const app = resolve(root, "apps/discord-bot");
  const output = resolve("reports/mutation-validation/fixture");
  mkdirSync(output, { recursive: true });
  const put = (name, text) => {
    mkdirSync(resolve(root, name, ".."), { recursive: true });
    writeFileSync(resolve(root, name), text);
  };
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const read = (name) =>
    JSON.parse(readFileSync(resolve(app, "reports/mutation", name), "utf8"));
  const run = (name, { args = [], complete = true } = {}) => {
    const started = performance.now();
    const remaining = process.env.HERO_MUTATION_VALIDATION_DEADLINE
      ? Math.floor(
          (Date.parse(process.env.HERO_MUTATION_VALIDATION_DEADLINE) -
            Date.now()) /
            1000,
        ) - 1
      : 30;
    assert.ok(remaining >= 1, "Validation mutation budget exhausted");
    const log = execFileSync(
      process.execPath,
      [
        cli,
        "--workspace",
        root,
        "--base",
        "HEAD",
        "--scope",
        "all",
        "--budget",
        String(Math.min(30, remaining)),
        ...args,
      ],
      {
        encoding: "utf8",
        timeout: 40000,
        maxBuffer: 4e6,
        env: { ...process.env, GITHUB_STEP_SUMMARY: "" },
      },
    );
    writeFileSync(resolve(output, `${name}.log`), log);
    cpSync(resolve(app, "reports/mutation"), resolve(output, name), {
      recursive: true,
    });
    const summary = read("summary.json");
    assert.equal(summary.complete, complete, log);
    console.log(
      `${name}: ${((performance.now() - started) / 1000).toFixed(2)}s; unit reused ${summary.stages.unit?.reused ?? 0}, integration reused ${summary.stages.integration?.reused ?? 0}`,
    );
    return summary;
  };
  try {
    git("init", "-q");
    git("config", "user.email", "fixture@example.com");
    git("config", "user.name", "Fixture");
    put(".gitignore", "node_modules/\nreports/\n.stryker-tmp/\n");
    put("apps/discord-bot/package.json", '{"type":"module"}');
    put(
      "apps/discord-bot/vitest.mutation.config.ts",
      `export default { test: { include: [process.env.HERO_MUTATION_STAGE === 'unit' ? 'test/unit.test.ts' : 'test/integration.test.ts'] } };`,
    );
    put("apps/discord-bot/src/helper.ts", "export const delta = 2;\n");
    put(
      "apps/discord-bot/src/value.ts",
      `import { delta } from './helper.ts';
export const startup = 'ready';
export function unit(n: number) { return n + delta; }
export function integrated(n: number) { return n * 2; }
export function unobserved(n: number) { return n - 1; }
export function superficial(n: number) { return n + 1; }
`,
    );
    put(
      "apps/discord-bot/src/loader.ts",
      "export const factory = () => ({ value: 42 });\n",
    );
    put(
      "apps/discord-bot/test/unit.test.ts",
      `import { it, expect } from 'vitest';
import { unit, startup, superficial } from '../src/value.ts';
it('covered but weak assertion', () => { expect(typeof superficial(1)).toBe('number'); });
import { factory } from '../src/loader.ts';
const initialized = factory().value;
it('import-time setup', () => { expect(initialized).toBe(42); });
it('unit behavior', () => { expect(unit(2)).toBe(4); });
it('static initialization', () => { expect(startup).toBe('ready'); });
`,
    );
    put(
      "apps/discord-bot/test/integration.test.ts",
      `import { it, expect } from 'vitest';
import { unit, integrated } from '../src/value.ts';
it('assembled behavior', () => { expect(integrated(3)).toBe(6); });
it('overlapping unit observation', () => { expect(unit(2)).toBe(4); });
`,
    );
    mkdirSync(resolve(app, "node_modules"));
    for (const name of readdirSync(
      resolve(workspace, "apps/discord-bot/node_modules"),
    ))
      symlinkSync(
        resolve(workspace, "apps/discord-bot/node_modules", name),
        resolve(app, "node_modules", name),
      );
    git("add", ".");
    git("commit", "-qm", "fixture");
    const cold = run("cold", { args: ["--fresh"] });
    assert.ok(cold.statuses.RuntimeError > 0);
    assert.ok(cold.statuses.Survived > 0);
    const unit = read("unit/progress.json").mutants;
    const integration = read("integration/progress.json").mutants;
    assert.ok(unit.some((m) => m.status === "Killed"));
    const integrated = unit.filter((m) => m.location.start.line === 3);
    assert.ok(integrated.length > 0);
    assert.ok(integrated.every((m) => m.status === "NoCoverage"));
    assert.ok(
      integrated.some(
        (m) => integration.find((r) => r.key === m.key)?.status === "Killed",
      ),
    );
    for (const m of unit.filter((m) => m.status === "Killed"))
      assert.equal(integration.find((r) => r.key === m.key)?.status, "Ignored");
    const staticMutants = read("unit/mutation.json").files[
      "src/value.ts"
    ].mutants.filter((m) => m.static);
    assert.ok(staticMutants.some((m) => m.status === "Killed"));
    const warm = run("warm");
    assert.ok(warm.stages.unit.reused > 0);
    assert.ok(warm.stages.integration.reused > 0);
    assert.deepEqual(warm.statuses, cold.statuses);
    put("README.md", "Only documentation changed.\n");
    const docs = run("docs-only");
    assert.equal(docs.stages.unit.reused, warm.stages.unit.reused);
    assert.equal(
      docs.stages.integration.reused,
      warm.stages.integration.reused,
    );
    put(
      "apps/discord-bot/src/helper.ts",
      "export const delta = 2;\n// dependency input changed\n",
    );
    const changed = run("dependency-change");
    assert.equal(changed.stages.unit.reused, 0);
    assert.equal(changed.stages.integration.reused, 0);
    assert.deepEqual(changed.statuses, cold.statuses);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
