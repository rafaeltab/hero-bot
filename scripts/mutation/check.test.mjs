import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";

const cli = resolve("scripts/mutation/run.mjs");
test("plans only added production lines against an explicit base, including working tree changes", () => {
  const root = mkdtempSync(`${tmpdir()}/hero-mutation-scope-`);
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const put = (name, text) => {
    mkdirSync(resolve(root, name, ".."), { recursive: true });
    writeFileSync(resolve(root, name), text);
  };
  try {
    git("init", "-q");
    git("config", "user.email", "fixture@example.com");
    git("config", "user.name", "Fixture");
    put(
      "apps/discord-bot/src/value.ts",
      'export const unchanged = "stable";\nexport const changed = "old";\n',
    );
    git("add", ".");
    git("commit", "-qm", "base");
    const base = git("rev-parse", "HEAD").trim();
    put(
      "apps/discord-bot/src/value.ts",
      'export const unchanged = "stable";\nexport const changed = "new";\n',
    );
    put("apps/discord-bot/src/new.ts", 'export const added = "new";\n');
    put("apps/discord-bot/src/model.d.ts", "export type Model = string;\n");
    put(
      "apps/discord-bot/src/generated/value.ts",
      'export const generated = "new";\n',
    );
    put(
      "apps/discord-bot/test/value.test.ts",
      'throw new Error("never mutate tests");\n',
    );
    for (const directory of ["__generated__", "test", "__tests__"]) {
      put(
        `apps/discord-bot/src/${directory}/value.ts`,
        'export const excluded = "new";\n',
      );
    }
    put(
      "apps/discord-bot/src/type-only.ts",
      "export interface Contract { value: string }\n",
    );
    const output = JSON.parse(
      execFileSync(
        process.execPath,
        [cli, "--workspace", root, "--base", base, "--plan"],
        { encoding: "utf8" },
      ),
    );
    assert.deepEqual(output.mutate, [
      "src/new.ts:1:0-1:27",
      "src/value.ts:2:0-2:29",
    ]);
    assert.equal(output.base, base);
    assert.equal(output.selection, "full-suite");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an empty scope replaces stale results with an explicit no-mutations outcome", () => {
  const root = mkdtempSync(`${tmpdir()}/hero-mutation-empty-`);
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" });
  try {
    git("init", "-q");
    git("config", "user.email", "fixture@example.com");
    git("config", "user.name", "Fixture");
    writeFileSync(resolve(root, "README.md"), "fixture");
    git("add", ".");
    git("commit", "-qm", "base");
    const reports = resolve(root, "apps/discord-bot/reports/mutation");
    mkdirSync(reports, { recursive: true });
    writeFileSync(resolve(reports, "index.html"), "stale success");
    execFileSync(process.execPath, [
      cli,
      "--workspace",
      root,
      "--base",
      "HEAD",
    ]);
    assert.equal(existsSync(resolve(reports, "index.html")), false);
    assert.equal(
      JSON.parse(readFileSync(resolve(reports, "mutation.json"))).noMutations,
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
