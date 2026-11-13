import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { processStamp, root } from "./state.mjs";

export async function stopDevelopment() {
  const directory = join(root, "apps/discord-bot/.env.processes");
  if (!existsSync(directory)) return;
  for (const name of readdirSync(directory)) {
    const file = join(directory, name);
    let record;
    try {
      record = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (
      !Number.isInteger(record.pid) ||
      record.pid <= 1 ||
      typeof record.stamp !== "string" ||
      name !== `${record.pid}.json`
    )
      throw Error("Invalid development process ownership.");
    if (processStamp(record.pid) !== record.stamp) {
      rmSync(file, { force: true });
      continue;
    }
    try {
      process.kill(record.pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    for (
      let attempt = 0;
      attempt < 100 && processStamp(record.pid) === record.stamp;
      attempt++
    )
      await delay(100);
    if (processStamp(record.pid) === record.stamp)
      throw Error(
        "Development process did not stop gracefully; infrastructure and allocation retained.",
      );
    rmSync(file, { force: true });
  }
}
