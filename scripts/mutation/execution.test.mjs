import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const workspace = process.cwd();
const cli = resolve("scripts/mutation/run.mjs");

test("real mutation reports separate line scope, per-test coverage, static fallback, cache reuse and full-suite execution", {
  timeout: 240000,
}, () => {
  mkdirSync(".mutation-fixtures", { recursive: true });
  const root = mkdtempSync(resolve(".mutation-fixtures/run-"));
  const app = resolve(root, "apps/discord-bot");
  const put = (path, text) => {
    mkdirSync(resolve(root, path, ".."), { recursive: true });
    writeFileSync(resolve(root, path), text);
  };
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const run = (...args) =>
    execFileSync(
      process.execPath,
      [cli, "--workspace", root, "--base", base, ...args],
      { encoding: "utf8", timeout: 90000, maxBuffer: 4e6 },
    );
  const report = () =>
    JSON.parse(
      readFileSync(resolve(app, "reports/mutation/mutation.json"), "utf8"),
    );
  try {
    git("init", "-q");
    git("config", "user.email", "fixture@example.com");
    git("config", "user.name", "Fixture");
    put(".gitignore", "node_modules/\nreports/\n.stryker-tmp/\n");
    put(
      "apps/discord-bot/package.json",
      JSON.stringify({
        type: "module",
        scripts: {
          build: 'node -e "0"',
          test: `${process.execPath} ${resolve(workspace, "apps/discord-bot/node_modules/vitest/vitest.mjs")} run`,
        },
      }),
    );
    put(
      "apps/discord-bot/vitest.config.ts",
      'export default { test: { include: ["test/**/*.test.ts"] } };',
    );
    put(
      "apps/discord-bot/src/values.ts",
      'export const startup = "before";\nexport function changed(n: number) {\n  return n + 1;\n}\nexport function untouched(n: number) { return n - 1; }\n',
    );
    put(
      "apps/discord-bot/test/values.test.ts",
      `import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { changed, startup, untouched } from '../src/values.ts';
it.effect('target', () => Effect.sync(() => { expect(changed(2)).toBe(4); }));
it('initialization', () => { expect(startup).toBe('ready'); });
it('unrelated', () => { expect(untouched(4)).toBe(3); });
`,
    );
    git("add", ".");
    git("commit", "-qm", "before");
    const baseValue = git("rev-parse", "HEAD").trim();
    // Set only after initialization so the closure always uses the explicit comparison commit.
    base = baseValue;
    put(
      "apps/discord-bot/src/values.ts",
      'export const startup = "ready";\nexport function changed(n: number) {\n  return n + 2;\n}\nexport function untouched(n: number) { return n - 1; }\n',
    );
    symlinkSync(
      resolve(workspace, "apps/discord-bot/node_modules"),
      resolve(app, "node_modules"),
      "dir",
    );
    const freshLog = run("--selection", "per-test");
    const fresh = report();
    const mutants = fresh.files["src/values.ts"].mutants.filter(
      (m) => m.status !== "Ignored",
    );
    assert.ok(mutants.length > 0);
    assert.deepEqual(
      [...new Set(mutants.map((m) => m.location.start.line))].sort(),
      [1, 3],
    );
    const arithmetic = mutants.find(
      (m) => m.mutatorName === "ArithmeticOperator",
    );
    assert.equal(arithmetic.status, "Killed");
    assert.equal(arithmetic.coveredBy.length, 1);
    assert.equal(arithmetic.testsCompleted, 1);
    const initialization = mutants.find(
      (m) => m.mutatorName === "StringLiteral",
    );
    assert.equal(initialization.static, true);
    assert.equal(initialization.testsCompleted, 3);
    assert.equal(initialization.status, "Killed");
    const shardMutants = [];
    for (let index = 1; index <= 2; index++) {
      run("--selection", "per-test", "--shard", `${index}/2`);
      const shard = JSON.parse(
        readFileSync(
          resolve(app, `reports/mutation/shard-${index}-of-2/mutation.json`),
          "utf8",
        ),
      );
      shardMutants.push(
        ...Object.values(shard.files).flatMap((file) => file.mutants),
      );
    }
    const identity = (mutant) =>
      JSON.stringify([
        mutant.location,
        mutant.mutatorName,
        mutant.replacement,
        mutant.status,
      ]);
    assert.deepEqual(
      shardMutants.map(identity).sort(),
      mutants.map(identity).sort(),
    );
    const firstCacheLog = run("--selection", "per-test", "--incremental");
    const reusedLog = run("--selection", "per-test", "--incremental");
    assert.match(reusedLog, /2 of 2 mutant result\(s\) are reused/);
    const cachedFile = report().config.incrementalFile;
    const testPath = resolve(app, "test/values.test.ts");
    writeFileSync(
      testPath,
      readFileSync(testPath, "utf8") +
        "\n// changed test inputs require fresh static results\n",
    );
    run("--selection", "per-test", "--incremental");
    assert.notEqual(report().config.incrementalFile, cachedFile);
    put(
      "apps/discord-bot/src/child.ts",
      "export function childValue(n: number) { return n + 1; }\n",
    );
    put(
      "apps/discord-bot/src/advisory.ts",
      'export const untested = "survivor";\n',
    );
    put(
      "apps/discord-bot/test/child.test.ts",
      `import { execFileSync } from 'node:child_process';
import { it, expect } from 'vitest';
it('subprocess integration', () => {
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', 'import { childValue } from "./src/child.ts"; console.log(childValue(7));'], { encoding: 'utf8' });
  expect(output.trim()).toBe('8');
});`,
    );
    run("--selection", "per-test");
    const incomplete = report();
    assert.ok(
      incomplete.files["src/child.ts"].mutants.every(
        (m) => m.status === "NoCoverage",
      ),
    );
    const fullLog = run();
    const full = report();
    assert.equal(
      full.files["src/values.ts"].mutants.find(
        (m) => m.mutatorName === "ArithmeticOperator",
      ).status,
      "Killed",
    );
    assert.ok(
      full.files["src/child.ts"].mutants.every((m) => m.status === "Killed"),
    );
    assert.ok(
      full.files["src/advisory.ts"].mutants.some(
        (m) => m.status === "Survived",
      ),
    );
    git(
      "add",
      "apps/discord-bot/src/values.ts",
      "apps/discord-bot/src/child.ts",
      "apps/discord-bot/test",
    );
    git("commit", "-qm", "covered changes now at base");
    base = git("rev-parse", "HEAD").trim();
    const zeroScoreLog = run();
    const zeroScore = report();
    assert.deepEqual(Object.keys(zeroScore.files), ["src/advisory.ts"]);
    assert.ok(
      zeroScore.files["src/advisory.ts"].mutants.every(
        (m) => m.status === "Survived",
      ),
    );
    assert.match(zeroScoreLog, /Final mutation score of 0.00/);
    // Preserve compact machine-readable evidence outside the disposable fixture.
    mkdirSync("reports/mutation-fixtures", { recursive: true });
    for (const [name, value] of Object.entries({
      fresh,
      incomplete,
      full,
      freshLog,
      firstCacheLog,
      reusedLog,
      fullLog,
      zeroScore,
      zeroScoreLog,
    })) {
      writeFileSync(
        `reports/mutation-fixtures/${name}.${typeof value === "string" ? "log" : "json"}`,
        typeof value === "string" ? value : JSON.stringify(value, null, 2),
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
let base;
