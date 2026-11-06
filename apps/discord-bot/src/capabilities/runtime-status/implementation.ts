import { Effect, Layer } from "effect";
import { RuntimeStatus } from "./contract.ts";
import { type Environment, EnvironmentSource } from "./ports.ts";

const describe = (environment: Environment): string =>
  `hero-bot started (${environment})`;

export const RuntimeStatusLive = Layer.effect(
  RuntimeStatus,
  Effect.gen(function* () {
    const source = yield* EnvironmentSource;
    return RuntimeStatus.of({
      describe: source.read.pipe(Effect.map(describe)),
    });
  }),
);
