import { Effect, Layer } from "effect";
import { openAITextLive } from "../dist/adapters/ai.js";
import { budgetSettings } from "../dist/adapters/budget-config.js";
import { budgetPostgresLayer } from "../dist/adapters/budget-postgres.js";
import { AiBudget } from "../dist/capabilities/ai-budget/contract.js";
import { TextGenerationUnavailable } from "../dist/capabilities/text-generation/contract.js";

/** Paid tools share the runtime ledger; synthetic evidence never selects billing scope. */
export const paidTextLayer = (guildId, observe = () => Effect.void) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const policy = yield* budgetSettings;
      if (!/^[1-9]\d*$/u.test(guildId ?? "") || !policy.guildMicroUsd[guildId])
        return yield* Effect.fail(
          new TextGenerationUnavailable({
            operation: "configuration",
            guidance:
              "Use --guild <configured-guild-id> with HERO_AI_BUDGET_JSON and DATABASE_URL; see evaluations/README.md.",
          }),
        );
      const context = yield* Layer.build(budgetPostgresLayer(policy));
      const budget = yield* AiBudget.pipe(Effect.provide(context));
      return openAITextLive({
        modelId: policy.model,
        maxOutputTokens: policy.maxOutputTokens,
        beforeAttempt: (event) => budget.reserve({ ...event, guildId }),
        afterAttempt: (event) =>
          budget
            .settle({ ...event, guildId })
            .pipe(Effect.andThen(observe({ ...event, guildId }))),
      });
    }),
  );
