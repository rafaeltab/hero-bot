import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { ConfigProvider, Effect, Layer } from "effect";
import { openAITextLive } from "../dist/adapters/ai.js";
import {
  judgmentInstructions,
  parseJudgment,
} from "../dist/capabilities/moderation/judgment.js";
import { initialPolicy } from "../dist/capabilities/moderation/policy.js";
import { TextGeneration } from "../dist/capabilities/text-generation/contract.js";

const paid = process.argv.includes("--paid");
const output = process.argv[process.argv.indexOf("--output") + 1];
if (!process.argv.includes("--output") || !output)
  throw Error(
    "Use --output <path>; --paid explicitly enables provider spending.",
  );
const source = await readFile(
  new URL("../../../evaluations/policy-cases.json", import.meta.url),
  "utf8",
);
const cases = JSON.parse(source);
const system = `${judgmentInstructions}\n${initialPolicy}`;
const hash = (s) => createHash("sha256").update(s).digest("hex");
const program = Effect.gen(function* () {
  const ai = yield* TextGeneration;
  const results = [];
  for (const c of cases.cases) {
    const input = JSON.stringify({
      text: c.text,
      ...(c.evidence ?? {}),
      limitations: c.limitations ?? [
        "Conversation/history/attachment contents unavailable.",
      ],
    });
    const result = yield* ai.generate(input, system).pipe(
      Effect.map((raw) => {
        try {
          return { actual: parseJudgment(raw) };
        } catch {
          return { failure: "invalid-output" };
        }
      }),
      Effect.catch(() => Effect.succeed({ failure: "provider-unavailable" })),
    );
    results.push({
      id: c.id,
      input,
      expected: {
        action: c.expected,
        offendingUrls: c.urls,
        reasonRubric: c.rubric,
      },
      ...result,
    });
  }
  return results;
});
const controlled = Layer.succeed(TextGeneration, {
  generate: (input) =>
    Effect.sync(() => {
      const c = cases.cases.find((c) => c.text === JSON.parse(input).text);
      return JSON.stringify({
        action: c.expected,
        reason: c.rubric,
        offendingUrls: c.urls,
      });
    }),
});
const results = await Effect.runPromise(
  program.pipe(
    Effect.provide(
      paid ? openAITextLive({ modelId: "gpt-6-luna" }) : controlled,
    ),
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv())),
  ),
);
await writeFile(
  output,
  JSON.stringify(
    {
      formatVersion: 1,
      mode: paid ? "paid-provider" : "controlled-plumbing-only",
      runAt: new Date().toISOString(),
      commit: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      caseVersion: cases.version,
      caseHash: hash(source),
      promptHash: hash(system),
      prompt: system,
      model: "gpt-6-luna",
      provider: "openai/chat",
      configuration: { maxRetries: 0, tools: false },
      results,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Policy evaluation written (${paid ? "paid provider" : "controlled plumbing only"}); review expected/actual and reason rubrics. No numerical release threshold.`,
);
