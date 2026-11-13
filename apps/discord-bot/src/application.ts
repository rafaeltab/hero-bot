import { Console, Effect, Layer } from "effect";
import { openAITextLive } from "./adapters/ai.ts";
import { discordDevelopmentLayer } from "./adapters/discord-development.ts";
import { DiscordNodeTransport } from "./adapters/discord-node.ts";
import { EnvironmentFromConfig } from "./adapters/environment-config.ts";
import { guildAccessLayer } from "./adapters/moderation-discord.ts";
import { configurationPostgresLayer } from "./adapters/moderation-postgres.ts";
import {
  awaitModerationReady,
  moderationDiscordLayer,
  moderationSettings,
  runModerationCommands,
} from "./adapters/moderation-runtime.ts";
import {
  DiscordConnection,
  type DiscordUnavailable,
} from "./capabilities/discord-connection/contract.ts";
import { ModerationLive } from "./capabilities/moderation/implementation.ts";
import {
  RuntimeStatus,
  type StatusUnavailable,
} from "./capabilities/runtime-status/contract.ts";
import { RuntimeStatusLive } from "./capabilities/runtime-status/implementation.ts";

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

// Distinct opt-in configuration runtime. AI configuration is validated, never called.
export const moderationProgram = Effect.scoped(
  Effect.gen(function* () {
    const settings = yield* moderationSettings;
    yield* Layer.build(openAITextLive());
    const storage = yield* Layer.build(configurationPostgresLayer());
    const discord = yield* Layer.build(moderationDiscordLayer(settings.token));
    const botId = yield* awaitModerationReady(
      settings.applicationId,
      settings.guildIds,
    ).pipe(Effect.provide(discord));
    return yield* runModerationCommands(
      settings.applicationId,
      settings.guildIds,
    ).pipe(
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
