import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { configure } from "./configure.mjs";
import { runDevelopment, stopDevelopment } from "./development.mjs";
import { startInfra, stopInfra } from "./infra.mjs";
import {
  gitDir,
  identity,
  identityPath,
  registry,
  registryPath,
  stateDir,
  writePrivate,
} from "./state.mjs";

const script = fileURLToPath(import.meta.url);
const [command, locked] = process.argv.slice(2);
async function lockRun(lock, args, nonblocking = false) {
  const child = spawn(
    "flock",
    [
      "--no-fork",
      nonblocking ? "--nonblock" : "--exclusive",
      "--conflict-exit-code",
      "73",
      lock,
      process.execPath,
      script,
      ...args,
    ],
    { stdio: "inherit" },
  );
  const forward = (signal) => child.kill(signal);
  process.on("SIGINT", forward);
  process.on("SIGTERM", forward);
  try {
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 130));
    });
    if (code === 73)
      console.error(
        "Another worktree owns the development Discord bot. Stop it before launching here.",
      );
    return code;
  } finally {
    process.off("SIGINT", forward);
    process.off("SIGTERM", forward);
  }
}
try {
  if (command === "dev") {
    identity();
    process.exitCode = await lockRun(
      join(stateDir, "discord.lock"),
      ["dev-guard"],
      true,
    );
  } else if (command === "dev-guard") {
    const value = identity();
    process.exitCode = await lockRun(
      join(stateDir, `${value.id}.lifetime.lock`),
      ["dev-owned"],
      true,
    );
  } else if (command === "dev-owned") {
    process.exitCode = await runDevelopment(identity());
  } else if (command === "teardown") {
    const value = identity();
    stopInfra(value, locked === "worktree-clean");
    if (locked === "worktree-clean") {
      const allocations = registry();
      delete allocations[gitDir];
      writePrivate(registryPath, JSON.stringify(allocations));
      rmSync(identityPath);
    }
    console.log(`${locked} completed for slot ${value.slot}.`);
  } else if (locked !== "--locked") {
    process.exitCode = await lockRun(join(stateDir, "registry.lock"), [
      command,
      "--locked",
    ]);
  } else if (command === "configure") {
    await configure();
  } else {
    const value = identity();
    switch (command) {
      case "infra-start":
        await startInfra(value);
        break;
      case "infra-stop":
        stopInfra(value);
        break;
      case "stop":
      case "worktree-clean": {
        await stopDevelopment(value);
        // Refuse teardown if a competing launch won the lifetime lock after stop.
        process.exitCode = await lockRun(
          join(stateDir, `${value.id}.lifetime.lock`),
          ["teardown", command],
          true,
        );
        break;
      }
      default:
        throw Error("Unknown worktree command.");
    }
  }
} catch (error) {
  console.error(`Worktree setup: ${error.message}`);
  process.exitCode = 1;
}
