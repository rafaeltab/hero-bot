import { Console, Effect, Layer } from "effect";

import { discordDevelopmentLayer } from "./adapters/discord-development.ts";
import { DiscordNodeTransport } from "./adapters/discord-node.ts";
import { EnvironmentFromConfig } from "./adapters/environment-config.ts";
import {
  DiscordConnection,
  type DiscordUnavailable,
} from "./capabilities/discord-connection/contract.ts";
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
