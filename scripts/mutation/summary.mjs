import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function summarizeShards(directory, count) {
  const plans = [];
  function walk(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (
        entry.name === "plan.json" &&
        JSON.parse(readFileSync(file, "utf8")).shard
      )
        plans.push(file);
    }
  }
  walk(directory);
  assert.equal(
    plans.length,
    count,
    "Incomplete analysis: missing or duplicate shard plans",
  );
  const seen = new Set();
  const ranges = [];
  const statuses = {};
  let reference;
  for (const path of plans) {
    const plan = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(plan.shard?.count, count, "Shard count mismatch");
    assert(
      plan.shard.index >= 1 &&
        plan.shard.index <= count &&
        !seen.has(plan.shard.index),
      "Invalid or duplicate shard index",
    );
    seen.add(plan.shard.index);
    const identity = JSON.stringify([
      plan.base,
      plan.fingerprint,
      plan.selection,
      plan.fullScope,
    ]);
    reference ??= identity;
    assert.equal(
      identity,
      reference,
      "Shards do not describe identical input/scope",
    );
    ranges.push(...plan.mutate);
    const reportBytes = readFileSync(join(path, "..", "mutation.json"));
    const receipt = JSON.parse(
      readFileSync(join(path, "..", "completed.json"), "utf8"),
    );
    assert.equal(
      receipt.fingerprint,
      plan.fingerprint,
      "Incomplete analysis: input receipt mismatch",
    );
    assert.equal(
      receipt.reportHash,
      createHash("sha256").update(reportBytes).digest("hex"),
      "Incomplete analysis: report changed after completion",
    );
    const report = JSON.parse(reportBytes);
    assert(
      report.files && (plan.mutate.length > 0 || report.noMutations),
      "Invalid shard report",
    );
    for (const file of Object.values(report.files)) {
      for (const mutant of file.mutants) {
        assert(
          [
            "Killed",
            "Survived",
            "Timeout",
            "NoCoverage",
            "CompileError",
            "RuntimeError",
            "Ignored",
          ].includes(mutant.status),
          "Incomplete mutant result",
        );
        statuses[mutant.status] = (statuses[mutant.status] ?? 0) + 1;
      }
    }
  }
  const fullScope = JSON.parse(readFileSync(plans[0], "utf8")).fullScope;
  assert.equal(
    new Set(ranges).size,
    ranges.length,
    "Duplicated mutation scope",
  );
  assert.deepEqual(
    [...ranges].sort(),
    [...fullScope].sort(),
    "Incomplete analysis: dropped mutation ranges",
  );
  return {
    complete: true,
    shards: count,
    ranges: ranges.length,
    mutants: Object.values(statuses).reduce((a, b) => a + b, 0),
    statuses,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const directory = process.argv[2];
  const count = Number(process.argv[3]);
  let summary;
  try {
    assert(
      directory &&
        existsSync(directory) &&
        Number.isSafeInteger(count) &&
        count > 0,
      "Expected report directory and positive shard count",
    );
    summary = summarizeShards(directory, count);
  } catch (error) {
    summary = { complete: false, error: error.message };
    process.exitCode = 1;
  }
  writeFileSync("mutation-summary.json", JSON.stringify(summary, null, 2));
  const text = `## Advisory mutations: ${summary.complete ? "complete" : "incomplete"}\n\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\`\n\nPer-shard JSON/HTML reports contain individual results. No score is claimed for incomplete analysis.\n`;
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
}
