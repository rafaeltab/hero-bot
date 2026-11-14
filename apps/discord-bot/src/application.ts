import { Console, Effect, Layer } from "effect";
import { openAITextLive } from "./adapters/ai.ts";
import { budgetSettings } from "./adapters/budget-config.ts";
import { budgetPostgresLayer } from "./adapters/budget-postgres.ts";
import { discordDevelopmentLayer } from "./adapters/discord-development.ts";
import { DiscordNodeTransport } from "./adapters/discord-node.ts";
import { EnvironmentFromConfig } from "./adapters/environment-config.ts";
import {
  contextBounds,
  evidenceContextDiscordLayer,
} from "./adapters/evidence-context-discord.ts";
import { reportsDiscordLayer } from "./adapters/intake-discord.ts";
import { runMessageCreations } from "./adapters/intake-events.ts";
import { intakePostgresLayer } from "./adapters/intake-postgres.ts";
import { guildAccessLayer } from "./adapters/moderation-discord.ts";
import { configurationPostgresLayer } from "./adapters/moderation-postgres.ts";
import {
  awaitModerationReady,
  moderationDiscordLayer,
  moderationSettings,
  runModerationCommands,
} from "./adapters/moderation-runtime.ts";
import { AiBudget } from "./capabilities/ai-budget/contract.ts";
import {
  DiscordConnection,
  type DiscordUnavailable,
} from "./capabilities/discord-connection/contract.ts";
import { ModerationLive } from "./capabilities/moderation/implementation.ts";
import { IntakeLive } from "./capabilities/moderation/intake.ts";
import {
  RuntimeStatus,
  type StatusUnavailable,
} from "./capabilities/runtime-status/contract.ts";
import { RuntimeStatusLive } from "./capabilities/runtime-status/implementation.ts";
import { TextGenerationUnavailable } from "./capabilities/text-generation/contract.ts";

// Until external adapters are wired, a scoped timer owns the process lifetime.
const Lifetime = Layer.effectDiscard(
  Effect.gen(function* () {
    const status = yield* RuntimeStatus;
    const description = yield* status.describe;
    yield* Effect.acquireRelease(
      Effect.sync(() => setInterval(() => {}, 60_000)),
      (timer) =>
        Effect.sync(() => clearInterval(timer)).pipe(
          Effect.andThen(Console.log("hero-bot stopped")),
        ),
    );
    yield* Console.log(description);
  }),
);

/** Runs until interrupted; interruption waits for scoped resources to finalize. */
export const application = Layer.launch(
  Lifetime.pipe(
    Layer.provide(RuntimeStatusLive.pipe(Layer.provide(EnvironmentFromConfig))),
  ),
);

/** Separate opt-in development path; validates development-only identity and server. */
export const developmentProgram = Effect.gen(function* () {
  const connection = yield* DiscordConnection;
  return yield* connection.run;
});

export const developmentApplication = developmentProgram.pipe(
  Effect.provide(
    discordDevelopmentLayer().pipe(Layer.provide(DiscordNodeTransport)),
  ),
);

export const applicationForDevelopment = (
  development: boolean,
): Effect.Effect<never, StatusUnavailable | DiscordUnavailable> =>
  development ? developmentApplication : application;

// Distinct opt-in notification runtime; creation intake and private setup share resources.
export const moderationProgram = Effect.scoped(
  Effect.gen(function* () {
    const settings = yield* moderationSettings;
    const bounds = yield* contextBounds;
    const policy = yield* budgetSettings;
    if (settings.guildIds.some((id) => policy.guildMicroUsd[id] === undefined))
      return yield* Effect.fail(
        new TextGenerationUnavailable({
          operation: "configuration",
          guidance:
            "Add every moderation guild to HERO_AI_BUDGET_JSON.guildMicroUsd; see docs/moderation-intake.md.",
        }),
      );
    const budgetContext = yield* Layer.build(budgetPostgresLayer(policy));
    const budget = yield* AiBudget.pipe(Effect.provide(budgetContext));
    const ai = yield* Layer.build(
      openAITextLive({
        modelId: "gpt-6-luna",
        beforeAttempt: budget.reserve,
        afterAttempt: budget.settle,
        maxOutputTokens: policy.maxOutputTokens,
      }),
    );
    const intakeStorage = yield* Layer.build(intakePostgresLayer());
    const storage = yield* Layer.build(configurationPostgresLayer());
    const discord = yield* Layer.build(moderationDiscordLayer(settings.token));
    const botId = yield* awaitModerationReady(
      settings.applicationId,
      settings.guildIds,
    ).pipe(Effect.provide(discord));
    const dependencies = Layer.mergeAll(
      Layer.succeedContext(budgetContext),
      Layer.succeedContext(storage),
      Layer.succeedContext(intakeStorage),
      Layer.succeedContext(ai),
      guildAccessLayer(botId).pipe(
        Layer.provide(Layer.succeedContext(discord)),
      ),
      evidenceContextDiscordLayer(bounds).pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeedContext(discord),
            Layer.succeedContext(intakeStorage),
          ),
        ),
      ),
      reportsDiscordLayer.pipe(Layer.provide(Layer.succeedContext(discord))),
    );
    return yield* Effect.all(
      [
        runModerationCommands(settings.applicationId, settings.guildIds),
        runMessageCreations(settings.guildIds),
      ],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.provide(IntakeLive.pipe(Layer.provide(dependencies))),
      Effect.provide(
        ModerationLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeedContext(storage),
              guildAccessLayer(botId).pipe(
                Layer.provide(Layer.succeedContext(discord)),
              ),
            ),
          ),
        ),
      ),
      Effect.provide(discord),
    );
  }),
);

export const moderationApplication = moderationProgram.pipe(
  Effect.provide(DiscordNodeTransport),
);
