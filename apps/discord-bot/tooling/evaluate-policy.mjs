import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { open, readFile, unlink } from "node:fs/promises";
import { ConfigProvider, Effect, Layer } from "effect";
import { judgmentInstructions } from "../dist/capabilities/moderation/judgment.js";
import { initialPolicy } from "../dist/capabilities/moderation/policy.js";
import { translateAudit } from "../dist/capabilities/moderation/translation.js";
import {
  TextGeneration,
  TextGenerationUnavailable,
} from "../dist/capabilities/text-generation/contract.js";
import { evaluationResult } from "./evaluation-result.mjs";
import { paidTextLayer } from "./paid-ai.mjs";

const hash = (s) => createHash("sha256").update(s).digest("hex");
const args = process.argv.slice(2);
const option = (name) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
const root = new URL("../../../", import.meta.url);
const load = async (path) => JSON.parse(await readFile(path, "utf8"));
let destination;
let destinationPath;
const save = async (_path, body) => {
  const integrity = hash(JSON.stringify(body));
  await destination.writeFile(
    `${JSON.stringify({ ...body, integrity }, null, 2)}\n`,
  );
};
const verified = async (path) => {
  const { integrity, ...body } = await load(path);
  if (hash(JSON.stringify(body)) !== integrity || body.formatVersion !== 2)
    throw Error("Report integrity or format invalid");
  return { ...body, integrity };
};
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function compare(output) {
  const i = args.indexOf("--compare");
  const left = await verified(args[i + 1]);
  const right = await verified(args[i + 2]);
  if (!left.results || !right.results)
    throw Error("Compare evaluation reports only");
  const fields = [
    "mode",
    "caseVersion",
    "caseHash",
    "commit",
    "workingTreeHash",
    "configuration",
    "promptHash",
    "model",
    "provider",
    "execution",
    "adapter",
  ];
  const ids = [
    ...new Set([...left.results, ...right.results].map((r) => r.id)),
  ];
  await save(output, {
    formatVersion: 2,
    kind: "comparison",
    runAt: new Date().toISOString(),
    reports: [left.integrity, right.integrity],
    differences: fields
      .filter((f) => !equal(left[f], right[f]))
      .map((field) => ({ field, before: left[field], after: right[field] })),
    results: ids.map((id) => {
      const a = left.results.find((r) => r.id === id);
      const b = right.results.find((r) => r.id === id);
      const comparable = (value) =>
        value
          ? JSON.parse(
              JSON.stringify(value, (key, v) =>
                key === "attemptedAt" ? undefined : v,
              ),
            )
          : null;
      return {
        id,
        changed: !equal(comparable(a), comparable(b)),
        before: a ?? null,
        after: b ?? null,
      };
    }),
    limitation:
      "Differences are observations, not a numerical release gate. Controlled results do not establish model quality; unlike case/prompt/model/configuration runs need separate interpretation.",
  });
}

async function evaluate(output) {
  const paid = args.includes("--paid");
  const guildId = option("--guild");
  if (paid && !/^[1-9]\d*$/u.test(guildId ?? ""))
    throw Error("Paid runs require --guild <configured-guild-id>");
  const spendContext = option("--spend-context");
  if (
    paid &&
    (!spendContext || !/^[a-zA-Z0-9#/_-]{1,100}$/u.test(spendContext))
  )
    throw Error(
      "Paid runs require --spend-context <non-secret-approval-reference>; see evaluations/README.md",
    );
  const source = await readFile(
    new URL("evaluations/policy-cases.json", root),
    "utf8",
  );
  const suite = JSON.parse(source);
  const configuration = option("--configuration")
    ? await load(option("--configuration"))
    : { version: "initial-policy", prompt: initialPolicy };
  if (
    typeof configuration.version !== "string" ||
    typeof configuration.prompt !== "string"
  )
    throw Error("Configuration needs synthetic version and prompt");
  const system = `${judgmentInstructions}\n${configuration.prompt}`;
  const selected = option("--case");
  const cases = suite.cases.filter((c) => !selected || c.id === selected);
  if (cases.length === 0) throw Error("Unknown case");
  const attempts = [];
  const execution = {
    selectedCase: selected ?? "all",
    controlledTranslationFailure: args.includes(
      "--controlled-translation-failure",
    ),
    controlledFault: args.includes("--controlled-invalid")
      ? "invalid-output"
      : null,
    tools: false,
    browsing: false,
    sdkRetries: 0,
    maximumTransportAttempts: 3,
    timeout: null,
    concurrency: "sequential evaluation only; runtime unchanged",
    translations: "retained actionable or retained edit evidence only",
    spendContext: paid ? spendContext : null,
    accounting: paid
      ? "runtime PostgreSQL ai_budget_attempts ledger; shared and per-guild admission/settlement; unknown usage retains capacity"
      : "no paid calls",
    ...(paid ? { budgetGuildId: guildId, budgetTimezone: "UTC" } : {}),
  };
  const controlled = Layer.succeed(TextGeneration, {
    generate: (input, _system, context) =>
      Effect.sync(() => {
        if (context?.purpose === "translation") {
          if (args.includes("--controlled-translation-failure"))
            throw new Error("controlled");
          return JSON.stringify(
            JSON.parse(input).map((excerpt) => {
              const fixture = cases.find(
                (c) => c.text === excerpt.original && c.controlledEnglish,
              );
              if (!fixture) throw new Error("controlled");
              return {
                pointer: excerpt.pointer,
                language: "es",
                english: fixture.controlledEnglish,
              };
            }),
          );
        }
        // Deliberate oracle echo: validates report plumbing only, never model quality.
        const c = cases.find(
          (c) =>
            c.source.messageId === JSON.parse(input).messageId &&
            c.source.version === JSON.parse(input).version,
        );
        return args.includes("--controlled-invalid")
          ? "invalid"
          : JSON.stringify({
              action: c.expected,
              reason: c.rubric,
              offendingUrls: c.urls,
            });
      }).pipe(
        Effect.catchDefect(() =>
          Effect.fail(new TextGenerationUnavailable({ operation: "generate" })),
        ),
      ),
  });
  const program = Effect.gen(function* () {
    const ai = yield* TextGeneration;
    const results = [];
    for (const c of cases) {
      const contents = [];
      for (const a of c.attachments ?? []) {
        const data = yield* Effect.promise(() =>
          readFile(
            new URL(`evaluations/fixtures/attachments/${a.fixture}`, root),
          ),
        );
        contents.push({ filename: a.fixture, mediaType: a.mediaType, data });
      }
      const attachments = contents.map((a) => ({
        filename: a.filename,
        mediaType: a.mediaType,
        bytes: a.data.length,
        sha256: hash(a.data),
      }));
      const evidence = {
        ...c.source,
        authorId: "subject",
        text: c.text,
        ...(c.evidence ?? {}),
        ...(attachments.length
          ? {
              attachmentInputs: attachments.map((a, index) => ({
                ...a,
                index,
                status: "supplied",
              })),
            }
          : {}),
        limitations: c.limitations ?? [
          "Synthetic evidence; no external destinations inspected; absent context/history unavailable.",
        ],
      };
      const input = JSON.stringify(evidence);
      const result = yield* ai
        .generate(
          input,
          system,
          { guildId: "evaluation", purpose: "judgment" },
          contents,
        )
        .pipe(evaluationResult);
      let translation = {
        status: "not-selected",
        limitation:
          "No retained actionable evidence or no valid judgment; originals are never replaced.",
      };
      if (result.actual && (result.actual.action !== "none" || c.sequence)) {
        translation = yield* translateAudit(
          {
            evidence,
            configuration,
            model: "gpt-6-luna",
            provider: paid ? "openai/chat" : "controlled/no-provider",
          },
          ai,
        );
      }
      results.push({
        id: c.id,
        version: c.version,
        acceptance: c.acceptance,
        caseHash: hash(JSON.stringify(c)),
        input,
        attachments,
        expected: {
          action: c.expected,
          offendingUrls: c.urls,
          reasonRubric: c.rubric,
          translationRubric:
            c.translationRubric ?? "No separate language quality claim.",
        },
        ...result,
        translation,
        observation: result.actual
          ? {
              actionMatches: result.actual.action === c.expected,
              urlsMatch: equal(
                [...result.actual.offendingUrls].sort(),
                [...c.urls].sort(),
              ),
              reasonReview: "unverified; human review required",
              readability: "unverified",
            }
          : { failure: result.failure, quality: "unverified" },
      });
    }
    return results;
  });
  const results = await Effect.runPromise(
    program.pipe(
      Effect.provide(
        paid
          ? paidTextLayer(guildId, (e) =>
              Effect.sync(() => {
                attempts.push({
                  guildId: e.guildId,
                  purpose: e.purpose,
                  attempt: e.attempt,
                  outcome: e.outcome,
                  inputTokens: e.inputTokens ?? null,
                  outputTokens: e.outputTokens ?? null,
                });
              }),
            )
          : controlled,
      ),
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv())),
    ),
  ).catch(() => null);
  const body = {
    formatVersion: 2,
    mode: paid ? "paid-provider" : "controlled-plumbing-only",
    quality: "unverified",
    runAt: new Date().toISOString(),
    commit: git("rev-parse", "HEAD").trim(),
    workingTreeHash: hash(
      git("diff", "HEAD", "--", ".", ":(exclude)evaluations/reports"),
    ),
    caseVersion: suite.version,
    caseHash: hash(source),
    configuration,
    prompt: system,
    promptHash: hash(system),
    model: "gpt-6-luna",
    modelRevision: "unavailable",
    provider: paid ? "openai/chat" : "controlled/no-provider",
    adapter: { ai: "7.0.163", openai: "4.0.109" },
    toolchain: { node: process.version, pnpm: "12.16.1 (repository pin)" },
    execution,
    attempts,
    failure: results === null ? "configuration-or-run-unavailable" : null,
    deterministicCases: suite.deterministicCases.map((c) => ({
      ...c,
      observation: "separate workflow tests; not executed by this runner",
    })),
    results: results ?? [],
    limitations: [
      "Controlled oracle echoes expected results and does not test policy quality, readability or injection resistance.",
      "Live model quality and Discord delivery remain unverified until #40.",
      "Provider errors and invalid output are sanitized failures, never none findings.",
    ],
  };
  // Only synthetic fixtures are accepted. Defense in depth against credential echoes.
  const secrets = Object.entries(process.env)
    .filter(
      ([key, value]) =>
        /KEY|TOKEN|SECRET|PASSWORD/u.test(key) && value?.length >= 8,
    )
    .map(([, value]) => value);
  const sanitized = JSON.stringify(body, (_key, value) =>
    typeof value === "string"
      ? secrets.reduce(
          (text, secret) => text.replaceAll(secret, "[REDACTED]"),
          value,
        )
      : value,
  );
  await save(output, JSON.parse(sanitized));
}

try {
  const output = option("--output");
  if (!output || output.startsWith("--"))
    throw Error("Use --output <new-report.json>");
  if (args.includes("--paid") && args.some((a) => a.startsWith("--controlled")))
    throw Error("Controlled faults cannot be used with paid mode");
  destination = await open(output, "wx", 0o600);
  destinationPath = output;
  if (args.includes("--compare")) await compare(output);
  else await evaluate(output);
  await destination.close();
  destination = undefined;
  console.log(
    "Sanitized evaluation artifact written; review limitations and provenance. No numerical AI gate.",
  );
} catch {
  if (destination) {
    await destination.close();
    await unlink(destinationPath);
  }
  console.error(
    "Evaluation unavailable: check arguments, configuration, build and new output path; no raw diagnostics emitted.",
  );
  process.exitCode = 1;
}
