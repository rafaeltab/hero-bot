import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";

import policy from "../apps/discord-bot/tooling/production-policy.cjs";
export const {
  applicationRoot,
  sourceRoot,
  excludedSourceDirectories,
  coverageExcludes,
} = policy;

export function isProductionPath(path) {
  const normalized = path.replaceAll("\\", "/");
  if (!normalized.startsWith(`${sourceRoot}/`)) return false;
  const relative = normalized.slice(sourceRoot.length + 1);
  if (
    relative
      .split("/")
      .some((name) => excludedSourceDirectories.includes(name)) ||
    relative.endsWith(".d.ts") ||
    /\.(test|spec)\.ts$/.test(relative)
  )
    return false;
  assert(relative.endsWith(".ts"), `Unsupported production input: ${path}`);
  return true;
}

export function hasRuntime(source) {
  const emitted = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      removeComments: true,
    },
  }).outputText;
  return Boolean(emitted.replace(/export\s*\{\s*\};?/g, "").trim());
}

export async function productionSources(
  root,
  { includeTypeOnly = false } = {},
) {
  const sources = [];
  async function walk(relative) {
    for (const entry of await readdir(join(root, relative), {
      withFileTypes: true,
    })) {
      if (excludedSourceDirectories.includes(entry.name)) continue;
      const path = `${relative}/${entry.name}`;
      assert(
        !entry.isSymbolicLink(),
        `Unsupported production symlink: ${path}`,
      );
      if (entry.isDirectory()) await walk(path);
      else if (
        isProductionPath(path) &&
        (includeTypeOnly ||
          hasRuntime(await readFile(join(root, path), "utf8")))
      )
        sources.push(join(root, path));
    }
  }
  await walk(sourceRoot);
  assert(sources.length > 0, "No runtime production sources");
  return sources.sort();
}
