import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigProvider, Effect } from "effect";
import { expect, it } from "vitest";
import { intakePostgresLayer } from "../src/adapters/intake-postgres.ts";
import { configurationPostgresLayer } from "../src/adapters/moderation-postgres.ts";
import {
  ConfigurationStore,
  IntakeStore,
} from "../src/capabilities/moderation/ports.ts";
import { configuration } from "./support/intake-fixture.ts";

it("executable moderation path judges actionable/harmless creations, exempts owner, deduplicates, retains exact report evidence and issues zero punishments", async () => {
  const guildId =
    String(Date.now()) + String(Math.floor(Math.random() * 100000));
  const dir = await mkdtemp(join(tmpdir(), "hero-intake-"));
  const path = join(dir, "reports.json");
  const config = ConfigProvider.layer(
    ConfigProvider.fromUnknown({
      DATABASE_URL: process.env.HERO_TEST_DATABASE_URL,
    }),
  );
  await Effect.runPromise(
    Effect.gen(function* () {
      const s = yield* ConfigurationStore;
      expect(
        yield* s.save({
          ...configuration,
          guildId,
          version: 0,
          roles: { Owner: [], Admin: [], Moderator: [] },
        }),
      ).toBe(1);
    }).pipe(
      Effect.provide(configurationPostgresLayer()),
      Effect.provide(config),
    ),
  );
  const child = spawn(process.execPath, ["test/support/intake-process.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      HERO_ENV: "development",
      DEV_DISCORD_BOT_TOKEN: "offline-secret",
      DEV_DISCORD_APPLICATION_ID: "123",
      DEV_MODERATION_GUILD_IDS: guildId,
      HERO_AI_API_KEY: "offline-key",
      HERO_AI_MODEL: "gpt-6-luna",
      DATABASE_URL: process.env.HERO_TEST_DATABASE_URL,
      HERO_TEST_REPORT_PATH: path,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const exited = new Promise((resolve) =>
    child.once("exit", (code, signal) => resolve({ code, signal })),
  );
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("offline intake timed out")),
        5000,
      );
      child.stdout.setEncoding("utf8").on("data", (chunk) => {
        output += chunk;
        if (output.includes("intake scenario complete")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.stderr.setEncoding("utf8").on("data", (chunk) => {
        output += chunk;
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(Error("offline process exited"));
      });
    });
    const observed = JSON.parse(await readFile(path, "utf8"));
    expect(observed.aiCalls).toBe(3);
    const writes = observed.calls.filter(
      (r: { method: string }) => r.method !== "GET",
    );
    expect(
      writes.every(
        (r: { method: string; url: string }) =>
          r.method === "POST" &&
          (/\/commands$/.test(r.url) ||
            /\/channels\/(30|thread)\/messages$/.test(r.url) ||
            r.url.endsWith("/channels/30/messages/root/threads")),
      ),
    ).toBe(true);
    const messages = writes.filter((r: { url: string }) =>
      r.url.endsWith("/messages"),
    );
    expect(messages[0].body.content).toContain("Recommendation: ban");
    expect(messages[0].body.content).toContain("Execution: disabled");
    expect(
      JSON.parse(
        messages
          .slice(1)
          .map((r: { body: { content: string } }) => r.body.content)
          .join(""),
      ),
    ).toMatchObject({
      evidence: { text: "https://bilibili.com/video/1", authorId: "12" },
      judgment: { action: "ban" },
    });
    await Effect.runPromise(
      Effect.gen(function* () {
        const s = yield* IntakeStore;
        expect(yield* s.read(guildId, "100")).toMatchObject([
          {
            record: {
              evidence: {
                text: "https://bilibili.com/video/1",
                authorId: "12",
              },
              configuration: { guildId },
              model: "gpt-6-luna",
            },
            delivery: { rootId: "root", threadId: "thread" },
          },
        ]);
        expect(yield* s.read(guildId, "101")).toEqual([]);
        expect(yield* s.read(guildId, "102")).toEqual([]);
      }).pipe(Effect.provide(intakePostgresLayer()), Effect.provide(config)),
    );
    expect(output).not.toContain("offline-secret");
    expect(output).not.toContain("exempt secret");
    expect(output).not.toContain("bilibili");
    child.kill("SIGTERM");
    expect(await exited).toEqual({ code: 130, signal: null });
  } finally {
    child.kill("SIGKILL");
    await exited;
    await rm(dir, { recursive: true, force: true });
  }
});
