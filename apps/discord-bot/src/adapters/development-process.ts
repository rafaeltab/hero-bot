import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

export function registerDevelopmentProcess(): void {
  const directory = new URL("../../.env.processes/", import.meta.url);
  const file = new URL(`${process.pid}.json`, directory);
  const stamp = readFileSync(`/proc/${process.pid}/stat`, "utf8")
    .split(") ")[1]
    ?.split(" ")[19];
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify({ pid: process.pid, stamp }), {
    mode: 0o600,
  });
  process.once("exit", () => rmSync(file, { force: true }));
}
