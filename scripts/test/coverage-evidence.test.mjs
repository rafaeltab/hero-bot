import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  fingerprint,
  productionSources,
  sealCoverage,
  validateEvidence,
} from "../coverage-evidence.mjs";

test("accepts sealed fresh coverage and rejects changed sources", async () => {
  const root = await mkdtemp(join(tmpdir(), "hero21-evidence-"));
  try {
    await mkdir(join(root, "apps/discord-bot/src/coverage"), {
      recursive: true,
    });
    await mkdir(join(root, "apps/discord-bot/coverage"), { recursive: true });
    await mkdir(join(root, "apps/discord-bot/coverage-crap"), {
      recursive: true,
    });
    const source = join(root, "apps/discord-bot/src/coverage/example.ts");
    await writeFile(source, "export const answer = () => 42;");
    const started = Date.now();
    const inputs = await fingerprint(root);
    await writeFile(
      join(root, "apps/discord-bot/coverage/coverage-summary.json"),
      "{}",
    );
    await writeFile(
      join(root, "apps/discord-bot/coverage-crap/coverage-final.json"),
      "{}",
    );
    await sealCoverage(root, started, inputs);
    await validateEvidence(root);
    const reportPath = join(
      root,
      "apps/discord-bot/coverage-crap/coverage-final.json",
    );
    await writeFile(reportPath, "{");
    await assert.rejects(validateEvidence(root), /Invalid or stale/);
    await writeFile(reportPath, "{}");
    const receiptPath = join(
      root,
      "apps/discord-bot/coverage-crap/receipt.json",
    );
    const receipt = await readFile(receiptPath, "utf8");
    const old = JSON.parse(receipt);
    old.started -= 3_600_001;
    await writeFile(receiptPath, JSON.stringify(old));
    await assert.rejects(validateEvidence(root), /stale/);
    await writeFile(receiptPath, "{");
    await assert.rejects(validateEvidence(root), SyntaxError);
    await rm(receiptPath);
    await assert.rejects(validateEvidence(root), /ENOENT/);
    await writeFile(receiptPath, receipt);
    await rm(reportPath);
    await assert.rejects(validateEvidence(root), /ENOENT/);
    await writeFile(reportPath, "{}");
    await writeFile(source, "export const answer = () => 43;");
    await assert.rejects(validateEvidence(root), /stale/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("inventories runtime source while excluding tests, generated files and type-only modules", async () => {
  const root = await mkdtemp(join(tmpdir(), "hero21-inventory-"));
  try {
    const directory = join(root, "apps/discord-bot/src");
    await mkdir(join(directory, "generated"), { recursive: true });
    for (const [path, content] of Object.entries({
      "runtime.ts": "export const answer = () => 42",
      "types.ts": "export interface Contract { value: number }",
      "ambient.d.ts": "declare const value: number",
      "runtime.test.ts": "throw 1",
      "generated/client.ts": "throw 1",
    }))
      await writeFile(join(directory, path), content);
    assert.deepEqual(await productionSources(root), [
      join(directory, "runtime.ts"),
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
