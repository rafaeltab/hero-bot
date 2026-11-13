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

it("executes the separate development entrypoint and fails safely without development credentials", async () => {
  const child = spawn(
    process.execPath,
    ["dist/main.js", "--discord-development"],
    {
      cwd: new URL("..", import.meta.url),
      // Preserve mutation activation in the compiled child without forwarding
      // development credentials or other service environment configuration.
      env: {
        HERO_ENV: "development",
        __STRYKER_ACTIVE_MUTANT__: process.env.__STRYKER_ACTIVE_MUTANT__,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  let errors = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk) => {
    errors += chunk;
  });
  try {
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    expect(code).toBe(1);
    expect(output).toContain("DiscordUnavailable");
    expect(output).toContain("configuration");
    expect(output).not.toContain("development Discord ready");
    expect(errors).toBe("");
  } finally {
    child.kill("SIGKILL");
  }
});

it.each([
  [{ HERO_ENV: "development" }, "ModerationUnavailable"],
  [
    {
      HERO_ENV: "development",
      DEV_DISCORD_BOT_TOKEN: "secret-placeholder",
      DEV_DISCORD_APPLICATION_ID: "123",
      DEV_MODERATION_GUILD_IDS: "10",
    },
    "TextGenerationUnavailable",
  ],
  [
    {
      HERO_ENV: "development",
      DEV_DISCORD_BOT_TOKEN: "secret-placeholder",
      DEV_DISCORD_APPLICATION_ID: "123",
      DEV_MODERATION_GUILD_IDS: "10",
      HERO_AI_API_KEY: "secret-key",
      HERO_AI_MODEL: "gpt-6-luna",
      DATABASE_URL: "secret-invalid",
    },
    "ModerationUnavailable",
  ],
])(
  "moderation entrypoint fails before dialing when shared startup configuration is invalid: %j",
  async (settings, expected) => {
    const child = spawn(process.execPath, ["dist/main.js", "--moderation"], {
      cwd: new URL("..", import.meta.url),
      env: {
        ...settings,
        __STRYKER_ACTIVE_MUTANT__: process.env.__STRYKER_ACTIVE_MUTANT__,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      output += chunk;
    });
    try {
      const code = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", resolve);
      });
      expect(code).toBe(1);
      expect(output).toContain(expected);
      expect(output).not.toContain("secret-");
    } finally {
      child.kill("SIGKILL");
    }
  },
);

import { randomUUID } from "node:crypto";
import { Client } from "pg";

it("moderation process acquires PostgreSQL and Discord then releases both on SIGTERM", async () => {
  const name = randomUUID();
  const url = new URL(
    process.env.HERO_TEST_DATABASE_URL ?? "postgres://unused",
  );
  url.searchParams.set("application_name", name);
  const child = spawn(
    process.execPath,
    ["test/support/moderation-process.mjs"],
    {
      cwd: new URL("..", import.meta.url),
      env: {
        HERO_ENV: "development",
        __STRYKER_ACTIVE_MUTANT__: process.env.__STRYKER_ACTIVE_MUTANT__,
        DEV_DISCORD_BOT_TOKEN: "offline-placeholder",
        DEV_DISCORD_APPLICATION_ID: "123",
        DEV_MODERATION_GUILD_IDS: "10,12",
        HERO_AI_API_KEY: "offline-placeholder",
        HERO_AI_MODEL: "gpt-6-luna",
        DATABASE_URL: url.href,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const observer = new Client({
    connectionString: process.env.HERO_TEST_DATABASE_URL,
  });
  await observer.connect();
  let output = "";
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(Error("moderation startup timed out")),
        5000,
      );
      child.stdout.setEncoding("utf8").on("data", (chunk) => {
        output += chunk;
        if (output.includes("configuration ready")) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child.once("exit", () => {
        clearTimeout(timeout);
        reject(Error("moderation exited before startup"));
      });
    });
    const active = await observer.query(
      "select count(*)::int as count from pg_stat_activity where application_name=$1",
      [name],
    );
    expect(active.rows).toEqual([{ count: 2 }]);
    child.kill("SIGTERM");
    expect(await exited).toEqual({ code: 130, signal: null });
    const closed = await observer.query(
      "select count(*)::int as count from pg_stat_activity where application_name=$1",
      [name],
    );
    expect(closed.rows).toEqual([{ count: 0 }]);
    expect(output).not.toContain("offline-placeholder");
  } finally {
    child.kill("SIGKILL");
    await exited;
    await observer.end();
  }
});
