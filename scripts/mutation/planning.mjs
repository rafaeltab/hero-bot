import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applicationRoot,
  hasRuntime,
  isProductionPath,
  sourceRoot,
} from "../production-policy.mjs";

export function planChanges(root, baseRef, { scope = "changed" } = {}) {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  const base = git("rev-parse", "--verify", `${baseRef}^{commit}`).trim();
  const paths = new Set(
    scope === "all"
      ? git(
          "ls-files",
          "--cached",
          "--others",
          "--exclude-standard",
          "-z",
          "--",
          sourceRoot,
        ).split("\0")
      : [
          ...git("diff", "--name-only", "-z", base, "--", sourceRoot).split(
            "\0",
          ),
          ...git(
            "ls-files",
            "--others",
            "--exclude-standard",
            "-z",
            "--",
            sourceRoot,
          ).split("\0"),
        ],
  );
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
      scope === "all" || before === undefined
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
      scope === "all"
        ? "all eligible production source in current working tree"
        : "exact base tree to current working tree (tracked plus untracked)",
    mutate,
    selection: "per-test",
    scope,
  };
}
