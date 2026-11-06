import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applicationRoot,
  hasRuntime,
  isProductionPath,
  sourceRoot,
} from "../production-policy.mjs";

export function planChanges(
  root,
  baseRef,
  { selection = "full-suite", incremental = false } = {},
) {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  const base = git("rev-parse", "--verify", `${baseRef}^{commit}`).trim();
  const paths = new Set([
    ...git("diff", "--name-only", "-z", base, "--", sourceRoot).split("\0"),
    ...git(
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      sourceRoot,
    ).split("\0"),
  ]);
  const mutate = [];
  for (const name of [...paths].sort()) {
    if (!isProductionPath(name)) continue;
    let source;
    try {
      if (lstatSync(resolve(root, name)).isSymbolicLink())
        throw new Error(`Unsupported production symlink: ${name}`);
      source = readFileSync(resolve(root, name), "utf8");
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (!hasRuntime(source)) continue;
    const lines = source.split("\n");
    let before;
    try {
      before = git("show", `${base}:${name}`);
    } catch {
      before = undefined;
    }
    // Git's zero-context added/replaced ranges; deletions have no current code to mutate.
    const hunks =
      before === undefined
        ? [[1, lines.at(-1) === "" ? lines.length - 1 : lines.length]]
        : [
            ...git(
              "diff",
              "--no-ext-diff",
              "--no-textconv",
              "--unified=0",
              base,
              "--",
              name,
            ).matchAll(/^@@ .* \+(\d+)(?:,(\d+))? @@/gm),
          ].map((match) => [Number(match[1]), Number(match[2] ?? 1)]);
    for (const [start, count] of hunks) {
      if (count > 0) {
        const end = start + count - 1;
        mutate.push(
          `${name.slice(applicationRoot.length + 1)}:${start}:0-${end}:${lines[end - 1].length}`,
        );
      }
    }
  }
  return {
    base,
    comparison:
      "exact base tree to current working tree (tracked plus untracked)",
    mutate,
    selection,
    incremental,
  };
}

// Partition whole original ranges, never split them: splitting lines could lose
// multiline instrumentable nodes at a new shard boundary.
export function shardPlan(plan, specification) {
  if (!specification) return plan;
  const match = /^(\d+)\/(\d+)$/.exec(specification);
  const index = Number(match?.[1]);
  const count = Number(match?.[2]);
  if (!Number.isSafeInteger(count) || count < 1 || index < 1 || index > count)
    throw new Error("--shard must be INDEX/COUNT with 1 <= INDEX <= COUNT");
  const bins = Array.from({ length: count }, () => ({ ranges: [], weight: 0 }));
  const weight = (range) => {
    const coordinates = /:(\d+):\d+-(\d+):\d+$/.exec(range);
    if (!coordinates) throw new Error(`Invalid mutation range: ${range}`);
    return Number(coordinates[2]) - Number(coordinates[1]) + 1;
  };
  for (const range of [...plan.mutate].sort(
    (a, b) => weight(b) - weight(a) || a.localeCompare(b),
  )) {
    const bin = bins.reduce((best, candidate) =>
      candidate.weight < best.weight ? candidate : best,
    );
    bin.ranges.push(range);
    bin.weight += weight(range);
  }
  const selected = new Set(bins[index - 1].ranges);
  return {
    ...plan,
    fullScope: plan.mutate,
    mutate: plan.mutate.filter((range) => selected.has(range)),
    shard: { index, count },
  };
}
