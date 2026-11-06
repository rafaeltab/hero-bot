import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import baseline from "../../apps/discord-bot/vitest.config.ts";
import attribution from "../../apps/discord-bot/vitest.crap.config.ts";
import {
  coverageExcludes,
  excludedSourceDirectories,
  isProductionPath,
  productionSources,
} from "../production-policy.mjs";

test("coverage and mutation eligibility share excluded directories and retain unimported production", async () => {
  const root = await mkdtemp(join(tmpdir(), "hero-policy-"));
  const src = "apps/discord-bot/src";
  try {
    const files = [
      "unimported.ts",
      "types.ts",
      "ambient.d.ts",
      "code.test.ts",
      "code.spec.ts",
      ...excludedSourceDirectories.map((dir) => `${dir}/code.ts`),
    ];
    for (const file of files) {
      await mkdir(join(root, src, file, ".."), { recursive: true });
      await writeFile(
        join(root, src, file),
        file === "types.ts"
          ? "export interface Contract { value: string }"
          : "export const value = 42;",
      );
    }
    assert.deepEqual(await productionSources(root), [
      join(root, src, "unimported.ts"),
    ]);
    assert.deepEqual(await productionSources(root, { includeTypeOnly: true }), [
      join(root, src, "types.ts"),
      join(root, src, "unimported.ts"),
    ]);
    for (const dir of excludedSourceDirectories)
      assert.equal(isProductionPath(`${src}/${dir}/code.ts`), false);
    assert.equal(isProductionPath(`${src}/unimported.ts`), true);
    assert.throws(
      () => isProductionPath(`${src}/new.js`),
      /Unsupported production/,
    );
    assert.deepEqual(baseline.test.coverage.exclude, coverageExcludes);
    assert.deepEqual(attribution.test.coverage.exclude, coverageExcludes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
