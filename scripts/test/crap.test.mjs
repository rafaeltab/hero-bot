import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { enforceScores, scoreFile } from "../crap.mjs";

const app = resolve("apps/discord-bot");
execFileSync(
  "pnpm",
  [
    "exec",
    "vitest",
    "run",
    "--coverage",
    "--config",
    "tooling-fixtures/crap/vitest.config.ts",
  ],
  { cwd: app },
);
const file = resolve(app, "tooling-fixtures/crap/representative.ts");
const source = await readFile(file, "utf8");
const coverage = JSON.parse(
  await readFile(
    resolve(app, "coverage-crap-fixtures/coverage-final.json"),
    "utf8",
  ),
)[file];

test("scores actual typed functions and deferred/nested Effect callbacks independently", () => {
  const scores = scoreFile(file, source, coverage).slice(0, 4);
  assert.deepEqual(
    scores.map(({ line, complexity, coverage, score }) => ({
      line,
      complexity,
      coverage,
      score,
    })),
    [
      { line: 4, complexity: 2, coverage: 2 / 3, score: 2.1481481481481484 },
      { line: 8, complexity: 1, coverage: 1, score: 1 },
      { line: 9, complexity: 2, coverage: 0.8, score: 2.032 },
      { line: 10, complexity: 2, coverage: 2 / 3, score: 2.1481481481481484 },
    ],
  );
});

test("rejects an uncalled production function with complexity 6 and CRAP 42", () => {
  const scores = scoreFile(file, source, coverage);
  assert.deepEqual(scores[4], {
    file,
    line: 19,
    column: 0,
    name: "uncalled",
    complexity: 6,
    coverage: 0,
    score: 42,
  });
  assert.throws(() => enforceScores(scores), /uncalled.*42/);
});

test("rejects missing function evidence instead of borrowing wrapper coverage", () => {
  const invalid = structuredClone(coverage);
  delete invalid.fnMap[2];
  delete invalid.f[2];
  assert.throws(() => scoreFile(file, source, invalid), /attribution/);
});

test("accepts exactly 30 and rejects 31 even with complete statement coverage", () => {
  const scores = scoreFile(file, source, coverage);
  assert.deepEqual(
    scores.slice(5, 7).map(({ complexity, coverage, score }) => ({
      complexity,
      coverage,
      score,
    })),
    [
      { complexity: 30, coverage: 1, score: 30 },
      { complexity: 31, coverage: 1, score: 31 },
    ],
  );
  enforceScores([scores[5]]);
  assert.throws(() => enforceScores([scores[6]]), /31/);
});

test("rejects coverage ignore directives in scored production source", () => {
  assert.throws(
    () =>
      scoreFile(
        file,
        `${source}
// v8 ignore next`,
        coverage,
      ),
    /ignore/,
  );
});

test("rejects unusable statement evidence for nonempty functions", () => {
  const invalid = structuredClone(coverage);
  invalid.statementMap = {};
  invalid.s = {};
  assert.throws(() => scoreFile(file, source, invalid), /statement evidence/);
});

test("does not transfer executed wrapper coverage to its unexecuted Effect generator", () => {
  const scores = scoreFile(file, source, coverage);
  assert.deepEqual(
    scores.slice(-2).map(({ complexity, coverage, score }) => ({
      complexity,
      coverage,
      score,
    })),
    [
      { complexity: 1, coverage: 1, score: 1 },
      { complexity: 6, coverage: 0, score: 42 },
    ],
  );
  assert.throws(() => enforceScores(scores.slice(-2)), /42/);
});

for (const [description, corrupt] of [
  [
    "negative statement counts",
    (report) => {
      report.s[0] = -1;
    },
  ],
  [
    "missing statement counts",
    (report) => {
      delete report.s[0];
    },
  ],
  [
    "non-numeric function counts",
    (report) => {
      report.f[0] = "1";
    },
  ],
  [
    "out-of-source coordinates",
    (report) => {
      report.fnMap[0].loc.start.line = 9999;
    },
  ],
  ["a missing production file", () => undefined],
]) {
  test(`rejects ${description}`, () => {
    let report = structuredClone(coverage);
    if (description === "a missing production file") report = undefined;
    else corrupt(report);
    assert.throws(() => scoreFile(file, source, report));
  });
}
