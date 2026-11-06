import { Config, Console, Effect, Layer } from "effect";

// Until external adapters are wired, a scoped timer owns the process lifetime.
const Lifetime = Layer.effectDiscard(
  Effect.gen(function* () {
    const environment = yield* Config.Literals(
      ["development", "production"],
      "HERO_ENV",
    );
    yield* Effect.acquireRelease(
      Effect.sync(() => setInterval(() => {}, 60_000)),
      (timer) =>
        Effect.sync(() => clearInterval(timer)).pipe(
          Effect.andThen(Console.log("hero-bot stopped")),
        ),
    );
    yield* Console.log(`hero-bot started (${environment})`);
  }),
);

/** Runs until interrupted; interruption waits for scoped resources to finalize. */
export const application = Layer.launch(Lifetime);
