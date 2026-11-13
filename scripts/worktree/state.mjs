import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const git = (...args) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
export const gitDir = realpathSync(git("rev-parse", "--absolute-git-dir"));
export const common = realpathSync(
  resolve(root, git("rev-parse", "--git-common-dir")),
);
export const stateDir = join(common, "hero-worktrees");
mkdirSync(stateDir, { recursive: true, mode: 0o700 });
export const registryPath = join(stateDir, "allocations.json");
export const identityPath = join(root, ".env.worktree.json");
export const appEnv = join(root, "apps/discord-bot/.env");
export const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
export function writePrivate(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, value, { mode: 0o600 });
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}
export const registry = () =>
  existsSync(registryPath) ? readJson(registryPath) : {};
export function identity() {
  if (!existsSync(identityPath))
    throw Error("Missing worktree identity; run make install.");
  const value = readJson(identityPath);
  const reserved = registry()[gitDir];
  if (
    !reserved ||
    JSON.stringify(value) !== JSON.stringify(reserved) ||
    !/^[0-9a-f-]{36}$/.test(value.id) ||
    !Number.isInteger(value.slot) ||
    value.slot < 0 ||
    value.slot >= 1000 ||
    value.gitDir !== gitDir
  ) {
    throw Error("Invalid worktree identity; refusing resource operations.");
  }
  return value;
}
export const resourceName = (value) => `hero-worktree-${value.id}`;
const basePort = 55420;
const portsPerSlot = 10;
export const databasePort = (value) => basePort + value.slot * portsPerSlot;
export const databaseUrl = (value) =>
  `postgresql://hero_test:hero_test@127.0.0.1:${databasePort(value)}/hero_test`;
export const processPath = (value) =>
  join(stateDir, `${value.id}.process.json`);
export function processStamp(pid) {
  try {
    return readFileSync(`/proc/${pid}/stat`, "utf8")
      .split(") ")[1]
      .split(" ")[19];
  } catch {
    return undefined;
  }
}
export function docker(...args) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    timeout: args[0] === "container" && args[1] === "create" ? 180000 : 20000,
  });
  if (result.error || result.status !== 0)
    throw Error(
      `Docker ${args[0]} failed (check daemon, ownership, or port availability).`,
    );
  return result.stdout.trim();
}
export function owned(kind, value) {
  const name = resourceName(value);
  const names = docker(
    kind,
    "ls",
    ...(kind === "container" ? ["-a"] : []),
    "--format",
    kind === "container" ? "{{.Names}}" : "{{.Name}}",
  );
  // Docker's container listing calls the field Names.
  if (!names.split("\n").includes(name)) return false;
  const data = JSON.parse(docker(kind, "inspect", name))[0];
  const labels = kind === "container" ? data.Config.Labels : data.Labels;
  if (
    labels?.["hero.worktree"] !== value.id ||
    labels?.["hero.repository"] !== common
  )
    throw Error(`Refusing unowned ${kind} ${name}.`);
  return true;
}
export async function portsAvailable(slot) {
  for (
    let port = databasePort({ slot });
    port < databasePort({ slot }) + portsPerSlot;
    port++
  ) {
    const free = await new Promise((done) => {
      const server = createServer();
      server.once("error", () => done(false));
      server.listen({ host: "127.0.0.1", port, exclusive: true }, () =>
        server.close(() => done(true)),
      );
    });
    if (!free) return false;
  }
  return true;
}
