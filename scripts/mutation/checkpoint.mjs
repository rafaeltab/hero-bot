import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

export function atomic(path, value) {
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2));
  renameSync(`${path}.tmp`, path);
}
export function readCheckpoint(path) {
  if (!existsSync(path)) return { version: 1, entries: {} };
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (
    value.version !== 1 ||
    !value.entries ||
    typeof value.entries !== "object"
  )
    throw Error("Unsupported or invalid mutation checkpoint");
  return value;
}
// Infrastructure/runtime errors and timeouts are rerun rather than cached.
export const reusable = (status) =>
  ["Killed", "Survived", "NoCoverage"].includes(status);

// Invalid mutants are finished observations, not test kills or tooling failure.
export const resolved = (status) =>
  [
    "Killed",
    "Timeout",
    "Survived",
    "NoCoverage",
    "RuntimeError",
    "CompileError",
    "Ignored",
  ].includes(status);

export function aggregate(unit, integration) {
  const statuses = {};
  let pending = 0;
  const integrated = new Map(integration.map((m) => [m.key, m]));
  for (const m of unit) {
    const needsIntegration = ["Survived", "NoCoverage"].includes(m.status);
    const result = needsIntegration ? integrated.get(m.key) : m;
    if (
      !result ||
      !resolved(result.status) ||
      (needsIntegration && result.status === "Ignored")
    )
      pending++;
    else {
      // At least one stage exercised the mutant: integration cannot erase
      // coverage already demonstrated by a surviving unit execution.
      const status =
        m.status === "Survived" && result.status === "NoCoverage"
          ? "Survived"
          : result.status;
      statuses[status] = (statuses[status] ?? 0) + 1;
    }
  }
  return { complete: pending === 0, mutants: unit.length, pending, statuses };
}
