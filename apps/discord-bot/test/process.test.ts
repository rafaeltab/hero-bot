import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";

it.each(["SIGTERM", "SIGINT"] as const)(
  "runs the configured production entry point until %s and releases its lifetime",
  async (signal) => {
    const child = spawn(process.execPath, ["dist/main.js"], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, HERO_ENV: "production" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let errors = "";
    const exited = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      errors += chunk;
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`Startup timeout: ${output} ${errors}`)),
          3000,
        );
        child.stdout.setEncoding("utf8").on("data", (chunk) => {
          output += chunk;
          if (output.includes("hero-bot started (production)")) {
            clearTimeout(timeout);
            resolve();
          }
        });
        child.once("exit", () => {
          clearTimeout(timeout);
          reject(new Error(`Exited before startup: ${errors}`));
        });
      });
      await delay(100);
      expect(child.exitCode).toBeNull();
      expect(child.signalCode).toBeNull();
      child.kill(signal);
      expect(await exited).toEqual({ code: 130, signal: null });
      expect(output.trim().split("\n")).toEqual([
        "hero-bot started (production)",
        "hero-bot stopped",
      ]);
      expect(errors).toBe("");
    } finally {
      child.kill("SIGKILL");
      await exited;
    }
  },
);
