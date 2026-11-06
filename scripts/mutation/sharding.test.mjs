import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { shardPlan } from "./planning.mjs";
import { summarizeShards } from "./summary.mjs";

test("balanced shards preserve every whole changed range exactly once", () => {
  const plan = {
    base: "fixture",
    selection: "full-suite",
    mutate: [
      "src/a.ts:1:0-50:10",
      "src/b.ts:1:0-20:10",
      "src/c.ts:1:0-5:10",
      "src/d.ts:1:0-5:10",
      "src/e.ts:1:0-5:10",
    ],
  };
  const shards = Array.from({ length: 4 }, (_, index) =>
    shardPlan(plan, `${index + 1}/4`),
  );
  assert.deepEqual(
    shards.flatMap((shard) => shard.mutate).sort(),
    [...plan.mutate].sort(),
  );
  assert.equal(
    new Set(shards.flatMap((shard) => shard.mutate)).size,
    plan.mutate.length,
  );
  assert.deepEqual(shardPlan(plan, "1/4"), shards[0]);
  assert.throws(() => shardPlan(plan, "0/4"), /INDEX/);
  assert.throws(() => shardPlan(plan, "2/1"), /INDEX/);
});

test("summary requires complete disjoint scope and finished reports from matching inputs", () => {
  const root = mkdtempSync(join(tmpdir(), "hero-shards-"));
  const plan = {
    base: "base",
    fingerprint: "inputs",
    selection: "full-suite",
    mutate: ["src/a.ts:1:0-4:10", "src/b.ts:1:0-4:10"],
  };
  const put = (
    index,
    report = {
      files: { "src/example.ts": { mutants: [{ status: "Killed" }] } },
    },
  ) => {
    const path = join(root, String(index));
    mkdirSync(path, { recursive: true });
    writeFileSync(
      join(path, "plan.json"),
      JSON.stringify(shardPlan(plan, `${index}/2`)),
    );
    const bytes = JSON.stringify(report);
    writeFileSync(join(path, "mutation.json"), bytes);
    writeFileSync(
      join(path, "completed.json"),
      JSON.stringify({
        fingerprint: plan.fingerprint,
        reportHash: createHash("sha256").update(bytes).digest("hex"),
      }),
    );
  };
  try {
    writeFileSync(join(root, "plan.json"), JSON.stringify(plan));
    put(1);
    assert.throws(() => summarizeShards(root, 2), /missing/);
    put(2);
    rmSync(join(root, "2/completed.json"));
    assert.throws(() => summarizeShards(root, 2), /ENOENT/);
    put(2);
    assert.deepEqual(summarizeShards(root, 2), {
      complete: true,
      shards: 2,
      ranges: 2,
      mutants: 2,
      statuses: { Killed: 2 },
    });
    put(2, { files: { a: { mutants: [{ status: "Pending" }] } } });
    assert.throws(() => summarizeShards(root, 2), /Incomplete mutant/);
    put(2);
    const changed = shardPlan(plan, "2/2");
    changed.fingerprint = "changed";
    writeFileSync(join(root, "2/plan.json"), JSON.stringify(changed));
    assert.throws(() => summarizeShards(root, 2), /identical/);
    const dropped = shardPlan(plan, "2/2");
    dropped.mutate = [];
    writeFileSync(join(root, "2/plan.json"), JSON.stringify(dropped));
    const bytes = JSON.stringify({ files: {}, noMutations: true });
    writeFileSync(join(root, "2/mutation.json"), bytes);
    writeFileSync(
      join(root, "2/completed.json"),
      JSON.stringify({
        fingerprint: plan.fingerprint,
        reportHash: createHash("sha256").update(bytes).digest("hex"),
      }),
    );
    assert.throws(() => summarizeShards(root, 2), /dropped/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
