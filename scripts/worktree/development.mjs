import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseEnv } from "node:util";
import {
  appEnv,
  databaseUrl,
  processPath,
  processStamp,
  readJson,
  root,
  writePrivate,
} from "./state.mjs";

export async function runDevelopment(value) {
  const path = processPath(value);
  // The per-worktree lifetime lock protects this process record during shutdown.
  const environment = parseEnv(readFileSync(appEnv, "utf8"));
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "src/main.ts", "--discord-development"],
    {
      cwd: join(root, "apps/discord-bot"),
      stdio: "inherit",
      env: {
        ...process.env,
        ...environment,
        HERO_ENV: "development",
        DATABASE_URL: databaseUrl(value),
        HERO_TEST_DATABASE_URL: databaseUrl(value),
      },
    },
  );
  const forward = (signal) => {
    child.kill(signal);
  };
  process.on("SIGTERM", forward);
  process.on("SIGINT", forward);
  writePrivate(
    path,
    JSON.stringify({
      pid: process.pid,
      stamp: processStamp(process.pid),
      id: value.id,
    }),
  );
  try {
    return await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 130));
    });
  } finally {
    rmSync(path, { force: true });
    process.off("SIGTERM", forward);
    process.off("SIGINT", forward);
  }
}
export async function stopDevelopment(value) {
  const path = processPath(value);
  if (!existsSync(path)) return;
  const record = readJson(path);
  if (
    record.id !== value.id ||
    !Number.isInteger(record.pid) ||
    record.pid <= 1 ||
    typeof record.stamp !== "string"
  )
    throw Error("Invalid development process ownership.");
  if (processStamp(record.pid) !== record.stamp) {
    rmSync(path);
    return;
  }
  process.kill(record.pid, "SIGTERM");
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!existsSync(path) && processStamp(record.pid) !== record.stamp) return;
    await delay(100);
  }
  throw Error(
    "Development process did not stop gracefully; infrastructure and allocation retained.",
  );
}
