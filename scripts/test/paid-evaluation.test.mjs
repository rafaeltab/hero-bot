import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { before, test } from "node:test";
import { parseEnv } from "node:util";

const app = resolve("apps/discord-bot");
const require = createRequire(join(app, "package.json"));
const { Client } = require("pg");
const databaseUrl =
  process.env.HERO_TEST_DATABASE_URL ??
  parseEnv(readFileSync(join(app, ".env"), "utf8")).HERO_TEST_DATABASE_URL;

before(() => {
  execFileSync("pnpm", ["--filter", "@hero-bot/discord-bot", "build"], {
    stdio: "pipe",
  });
});

const withLedger = async (run) => {
  const dir = await mkdtemp(join(tmpdir(), "hero-paid-evaluation-"));
  const schema = `test_paid_${randomUUID().replaceAll("-", "")}`;
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`create schema "${schema}"`);
    const url = new URL(databaseUrl);
    url.searchParams.set("options", `-csearch_path=${schema}`);
    const policy = {
      version: "controlled-tooling-1",
      pricing: "controlled-not-live",
      model: "gpt-6-luna",
      guildMicroUsd: { 10: 100, 20: 100, 30: 100 },
      sharedMicroUsd: 150,
      inputMicroUsdPerMillion: 1000000,
      outputMicroUsdPerMillion: 2000000,
      maxInputTokens: 40,
      maxOutputTokens: 10,
    };
    const preload = join(dir, "provider.mjs");
    const log = join(dir, "requests.jsonl");
    await writeFile(
      preload,
      `import { appendFileSync } from "node:fs";
      globalThis.fetch = async (_url, init) => {
        const body = JSON.parse(init.body);
        appendFileSync(process.env.HERO_QA_REQUESTS, JSON.stringify(body) + "\\n");
        const content = body.messages.find(m => m.role === "user").content;
        const input = JSON.parse(typeof content === "string" ? content : content[0].text);
        const result = Array.isArray(input)
          ? input.map(e => ({ pointer: e.pointer, language: "es", english: "I have unauthorized copies for distribution." }))
          : { action: "ban", reason: "Controlled fixture.", offendingUrls: ["https://example.org/course"] };
        return Response.json({ id: "qa", object: "chat.completion", created: 0, model: "gpt-6-luna",
          choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(result) }, finish_reason: "stop" }],
          ...(process.env.HERO_QA_UNKNOWN ? {} : { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }) });
      };`,
    );
    const env = {
      PATH: process.env.PATH,
      DATABASE_URL: url.href,
      HERO_AI_API_KEY: "controlled-no-network",
      HERO_AI_MODEL: "gpt-6-luna",
      HERO_AI_BUDGET_JSON: JSON.stringify(policy),
      HERO_QA_REQUESTS: log,
    };
    let sequence = 0;
    const invoke = async (tool, args = [], overrides = {}) => {
      const output = join(dir, `report-${sequence++}.json`);
      execFileSync(
        process.execPath,
        [
          "--import",
          preload,
          join(app, "tooling", tool),
          "--paid",
          ...args,
          "--output",
          output,
        ],
        { env: { ...env, ...overrides }, stdio: "pipe" },
      );
      return JSON.parse(await readFile(output, "utf8"));
    };
    const entries = async () =>
      (
        await client.query(
          `select * from "${schema}".ai_budget_attempts order by admitted_at`,
        )
      ).rows;
    const requests = async () => {
      try {
        return (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
      } catch {
        return [];
      }
    };
    await run({ invoke, entries, requests });
  } finally {
    await client.query(`drop schema "${schema}" cascade`);
    await client.end();
    await rm(dir, { recursive: true, force: true });
  }
};

test("paid policy judgments, translations and image/file demo share durable guild and application ceilings", () =>
  withLedger(async ({ invoke, entries, requests }) => {
    const policyArgs = [
      "--guild",
      "10",
      "--case",
      "spanish-original",
      "--spend-context",
      "controlled-QA",
    ];
    const first = await invoke("evaluate-policy.mjs", policyArgs);
    assert.equal(first.results[0].translation.status, "available");
    assert.equal(first.attempts.length, 2);
    assert.ok(first.attempts.every((a) => a.guildId === "10"));
    assert.deepEqual(
      (await entries()).map((e) => e.purpose),
      ["judgment", "translation"],
    );
    const second = await invoke("evaluate-policy.mjs", policyArgs);
    assert.equal(second.results[0].actual.action, "ban");
    assert.equal(second.results[0].translation.status, "unavailable");
    const denied = await invoke("evaluate-attachments.mjs", ["--guild", "10"]);
    assert.equal(denied.failure, "budget-exhausted");
    assert.equal((await requests()).length, 3);
    const image = await invoke("evaluate-attachments.mjs", ["--guild", "20"]);
    assert.equal(image.actual.action, "ban");
    await invoke("evaluate-attachments.mjs", ["--guild", "20"]);
    const sharedDenied = await invoke("evaluate-attachments.mjs", [
      "--guild",
      "30",
    ]);
    assert.equal(sharedDenied.failure, "budget-exhausted");
    const calls = await requests();
    assert.equal(calls.length, 5);
    assert.ok(calls.every((c) => c.max_completion_tokens === 10));
    const parts = calls[3].messages.find((m) => m.role === "user").content;
    assert.ok(
      parts.some(
        (p) =>
          p.type === "image_url" &&
          p.image_url.url.startsWith("data:image/png"),
      ),
    );
    assert.ok(
      parts.some(
        (p) =>
          p.type === "file" &&
          p.file.file_data.startsWith("data:application/pdf"),
      ),
    );
    const rows = await entries();
    assert.equal(
      rows.reduce((sum, e) => sum + Number(e.reported), 0),
      100,
    );
    assert.ok(
      rows.every(
        (e) =>
          e.known &&
          Number(e.held) === 0 &&
          e.policy.version === "controlled-tooling-1",
      ),
    );
  }));

test("paid tools retain unknown usage across process restart and fail closed on missing or unconfigured budgets", () =>
  withLedger(async ({ invoke, entries, requests }) => {
    await invoke("evaluate-attachments.mjs", ["--guild", "10"], {
      HERO_QA_UNKNOWN: "1",
    });
    const denied = await invoke("evaluate-attachments.mjs", ["--guild", "10"]);
    assert.equal(denied.failure, "budget-exhausted");
    assert.equal((await entries())[0].held, "60");
    assert.equal((await entries())[0].known, false);
    assert.equal((await requests()).length, 1);
    await assert.rejects(() => invoke("evaluate-attachments.mjs"));
    const unavailable = await invoke("evaluate-policy.mjs", [
      "--guild",
      "999",
      "--case",
      "bare-bilibili",
      "--spend-context",
      "controlled-QA",
    ]);
    assert.equal(unavailable.failure, "configuration-or-run-unavailable");
    const absent = await invoke(
      "evaluate-policy.mjs",
      ["--guild", "10", "--spend-context", "controlled-QA"],
      { HERO_AI_BUDGET_JSON: "" },
    );
    assert.equal(absent.failure, "configuration-or-run-unavailable");
    assert.equal((await requests()).length, 1);
  }));
