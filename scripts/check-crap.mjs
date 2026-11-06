import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { productionSources, validateEvidence } from "./coverage-evidence.mjs";
import { enforceScores, scoreFile } from "./crap.mjs";

export async function checkCrap(root) {
  await validateEvidence(root);
  const report = JSON.parse(
    await readFile(
      resolve(root, "apps/discord-bot/coverage-crap/coverage-final.json"),
      "utf8",
    ),
  );
  const sources = await productionSources(root);
  // A type-only module can have an empty entry, but never executable evidence.
  for (const [file, entry] of Object.entries(report)) {
    if (sources.includes(file)) continue;
    assert(
      file.startsWith(`${resolve(root, "apps/discord-bot/src")}/`) &&
        file.endsWith(".ts") &&
        Object.keys(entry.fnMap).length === 0 &&
        Object.keys(entry.statementMap).length === 0,
      `Unexpected coverage input: ${file}`,
    );
  }
  const scores = [];
  for (const file of sources)
    scores.push(...scoreFile(file, await readFile(file, "utf8"), report[file]));
  await writeFile(
    resolve(root, "apps/discord-bot/coverage-crap/scores.json"),
    `${JSON.stringify(scores, null, 2)}\n`,
  );
  enforceScores(scores);
  for (const {
    file,
    line,
    column,
    name,
    complexity,
    coverage,
    score,
  } of scores)
    console.log(
      `${file}:${line}:${column} ${name}: complexity=${complexity}, coverage=${coverage}, CRAP=${score}`,
    );
  console.log(`Validated CRAP <=30 for ${scores.length} production functions`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await checkCrap(process.cwd());
