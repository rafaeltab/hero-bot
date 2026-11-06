import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { productionSources } from "./coverage-evidence.mjs";

const app = new URL("../apps/discord-bot/", import.meta.url);
const report = JSON.parse(
  await readFile(new URL("coverage/coverage-summary.json", app), "utf8"),
);
const sources = await productionSources(process.cwd(), {
  includeTypeOnly: true,
});
assert(sources.length > 0, "No production sources found");
assert.deepEqual(
  Object.keys(report)
    .filter((key) => key !== "total")
    .sort(),
  sources.sort(),
  "Coverage must report every production source and no generated/test files",
);
for (const metric of ["statements", "branches"]) {
  let total = 0;
  let covered = 0;
  for (const source of [...sources, "total"]) {
    const entry = report[source]?.[metric];
    assert(entry, `Missing ${metric} for ${source}`);
    assert(Number.isInteger(entry.total) && entry.total >= 0, "Invalid total");
    assert(
      Number.isInteger(entry.covered) &&
        entry.covered >= 0 &&
        entry.covered <= entry.total,
      "Invalid covered count",
    );
    assert.equal(entry.skipped, 0, "Skipped coverage is invalid");
    const percentage =
      entry.total === 0
        ? 100
        : Math.floor((10000 * entry.covered) / entry.total) / 100;
    assert.equal(entry.pct, percentage, "Invalid percentage");
    if (source === "total") {
      assert.equal(entry.total, total, "Inconsistent total");
      assert.equal(entry.covered, covered, "Inconsistent covered count");
      assert(entry.pct >= 90, `${metric} coverage must be >=90%`);
    } else {
      total += entry.total;
      covered += entry.covered;
    }
  }
  if (metric === "statements")
    assert(total > 0, "Empty production coverage is invalid");
}
console.log(
  "Validated fresh production coverage: >=90% statements and branches",
);
