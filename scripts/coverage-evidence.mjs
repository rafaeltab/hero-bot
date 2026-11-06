import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export { productionSources } from "./production-policy.mjs";

const excludedDirectories = new Set(["node_modules", ".git", ".turbo"]);
const excludedOutputs = new Set([
  "apps/discord-bot/dist",
  "apps/discord-bot/coverage",
  "apps/discord-bot/coverage-crap",
  "apps/discord-bot/coverage-crap-fixtures",
]);
const reports = [
  "apps/discord-bot/coverage/coverage-summary.json",
  "apps/discord-bot/coverage-crap/coverage-final.json",
];
const receipt = "apps/discord-bot/coverage-crap/receipt.json";
const digest = (value) => createHash("sha256").update(value).digest("hex");

export async function fingerprint(root) {
  const entries = [];
  async function walk(directory) {
    for (const entry of (
      await readdir(join(root, directory), { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (excludedDirectories.has(entry.name) || excludedOutputs.has(path))
        continue;
      assert(!entry.isSymbolicLink(), `Unsupported input symlink: ${path}`);
      if (entry.isDirectory()) await walk(path);
      else if (
        /\.(?:[cm]?[jt]sx?|json|ya?ml)$/.test(path) ||
        [".node-version", ".nvmrc"].includes(entry.name)
      )
        entries.push([path, digest(await readFile(join(root, path)))]);
    }
  }
  await walk("");
  return digest(JSON.stringify(entries));
}

export async function sealCoverage(root, started, inputs) {
  assert.equal(
    await fingerprint(root),
    inputs,
    "Coverage inputs changed during run",
  );
  const hashes = {};
  for (const path of reports) {
    assert(
      (await stat(join(root, path))).mtimeMs >= started - 1,
      "Report predates run",
    );
    const content = await readFile(join(root, path));
    JSON.parse(content.toString());
    hashes[path] = digest(content);
  }
  await writeFile(
    join(root, receipt),
    JSON.stringify({ started, finished: Date.now(), inputs, hashes }),
  );
}

export async function validateEvidence(root) {
  const evidence = JSON.parse(await readFile(join(root, receipt), "utf8"));
  assert(
    Number.isFinite(evidence.started) &&
      Number.isFinite(evidence.finished) &&
      evidence.started <= evidence.finished &&
      evidence.finished <= Date.now() &&
      Date.now() - evidence.started <= 3_600_000,
    "Invalid or stale coverage run time",
  );
  assert.equal(
    await fingerprint(root),
    evidence.inputs,
    "Coverage is stale: inputs changed",
  );
  assert.deepEqual(
    Object.keys(evidence.hashes).sort(),
    [...reports].sort(),
    "Invalid report inventory",
  );
  for (const path of reports) {
    const content = await readFile(join(root, path));
    assert.equal(
      digest(content),
      evidence.hashes[path],
      "Invalid or stale coverage report",
    );
    JSON.parse(content.toString());
  }
}
