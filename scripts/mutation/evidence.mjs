import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";

export const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const identity = (mutant) =>
  digest([
    mutant.file,
    mutant.location,
    mutant.mutatorName,
    mutant.replacement,
  ]);

// A fresh coverage plan chooses the test roots. Follow their imports as well as
// the mutant's imports: a change in an adapter can alter a caller's mutant kill.
export function evidence(root, stage) {
  const app = resolve(root, "apps/discord-bot");
  const paths = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      cwd: root,
      encoding: "utf8",
    },
  )
    .split("\0")
    .filter(Boolean)
    .sort();
  const bytes = (path) =>
    existsSync(resolve(root, path))
      ? readFileSync(resolve(root, path), "utf8")
      : "<deleted>";
  const production = paths.filter((p) => p.startsWith("apps/discord-bot/src/"));
  const control = paths.filter(
    (p) =>
      p.startsWith("scripts/") ||
      p.startsWith(".github/workflows/") ||
      p.startsWith("apps/discord-bot/test/") ||
      p.startsWith("apps/discord-bot/tooling/") ||
      p.startsWith("evaluations/") ||
      /(^|\/)(package.json|pnpm-lock.yaml|pnpm-workspace.yaml|tsconfig[^/]*|vitest[^/]*|\.node-version|\.env[^/]*)$/.test(
        p,
      ),
  );
  const compatibility = digest([
    1,
    stage,
    process.version,
    process.platform,
    process.arch,
    Object.entries(process.env)
      .filter(
        ([key]) =>
          /^(HERO_|DEV_DISCORD_|DATABASE_URL$|NODE_OPTIONS$|TZ$)/.test(key) &&
          !["HERO_MUTATION_OPTIONS", "HERO_MUTATION_STAGE"].includes(key),
      )
      .sort(),
    [".env", "apps/discord-bot/.env"].map((p) => [p, bytes(p)]),
    control.map((p) => [p, bytes(p)]),
  ]);
  const all = digest(production.map((p) => [p, bytes(p)]));
  const memo = new Map();
  const closure = (roots) => {
    const seen = new Set();
    let unknown = false;
    function visit(file) {
      if (seen.has(file)) return;
      seen.add(file);
      const source = bytes(file);
      // Arbitrary dynamic loading cannot be accounted for by the import graph.
      if (/\b(import|require)\s*\(|\bimport\.meta\.glob/.test(source))
        unknown = true;
      for (const imp of ts.preProcessFile(source, true, true).importedFiles) {
        if (!imp.fileName.startsWith(".")) {
          // Workspace aliases are not configured in this app; unsupported aliases
          // conservatively depend on every production input.
          if (
            imp.fileName.startsWith("@/") ||
            imp.fileName.startsWith("#") ||
            imp.fileName.startsWith("@hero-bot/")
          )
            unknown = true;
          continue;
        }
        const target = resolve(dirname(resolve(root, file)), imp.fileName);
        const candidates = [
          target.replace(/\.js$/, ".ts"),
          target,
          `${target}.ts`,
          `${target}/index.ts`,
        ];
        const found = candidates.find(
          (p) => existsSync(p) && statSync(p).isFile(),
        );
        if (!found) unknown = true;
        else visit(relative(root, found));
      }
    }
    for (const file of roots) visit(file);
    return digest([
      unknown ? all : null,
      [...seen].sort().map((p) => [p, bytes(p)]),
    ]);
  };
  return (mutant, testFilter) => {
    const tests = testFilter?.map((id) => id.split("#")[0]);
    if (mutant.static || !tests?.length) return digest([compatibility, all]);
    const roots = [
      resolve(app, mutant.file),
      ...tests.map((p) => resolve(app, p)),
    ]
      .map((p) => relative(root, p))
      .sort();
    const key = JSON.stringify(roots);
    if (!memo.has(key)) memo.set(key, digest([compatibility, closure(roots)]));
    return memo.get(key);
  };
}
