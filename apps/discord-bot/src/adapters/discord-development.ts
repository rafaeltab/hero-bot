import { DiscordConfig } from "dfx";
import { DiscordGateway, DiscordLive } from "dfx/gateway";
import {
  Config,
  Console,
  Context,
  type Duration,
  Effect,
  Layer,
  Redacted,
  Schema,
  Stream,
} from "effect";
import type { HttpClient } from "effect/http/HttpClient";
import type { WebSocketConstructor } from "effect/socket/Socket";
import {
  DiscordConnection,
  DiscordUnavailable,
} from "../capabilities/discord-connection/contract.ts";

const snowflake = (name: string) =>
  Config.schema(Schema.String.check(Schema.isPattern(/^[1-9]\d*$/)), name);
const configuration = Config.all({
  environment: Config.Literal("development", "HERO_ENV"),
  token: Config.schema(
    Schema.String.check(Schema.isMinLength(1)),
    "DEV_DISCORD_BOT_TOKEN",
  ).pipe(Config.map(Redacted.make)),
  applicationId: snowflake("DEV_DISCORD_APPLICATION_ID"),
  guildId: snowflake("DEV_DISCORD_GUILD_ID"),
});

/** Transport requirements remain injectable for offline real-SDK checks.
 * The production composition supplies Node HTTP and WebSocket Layers.
 */
export const discordDevelopmentLayer = (
  readyTimeout: Duration.Input = "15 seconds",
) =>
  Layer.effect(
    DiscordConnection,
    Effect.gen(function* () {
      const settings = yield* configuration.pipe(
        Effect.mapError(
          () => new DiscordUnavailable({ reason: "configuration" }),
        ),
      );
      // Capture transports at construction; consumers need only the contract.
      const services = yield* Effect.context<
        HttpClient | WebSocketConstructor
      >();
      const run = Effect.gen(function* () {
        const ready = yield* Effect.gen(function* () {
          const context = yield* Layer.build(
            DiscordLive.pipe(
              Layer.provide(DiscordConfig.layer({ token: settings.token })),
            ),
          );
          const gateway = Context.get(context, DiscordGateway);
          return yield* Stream.runHead(gateway.fromDispatch("READY"));
        }).pipe(
          Effect.timeout(readyTimeout),
          Effect.mapError(
            () => new DiscordUnavailable({ reason: "connection" }),
          ),
        );
        if (
          ready._tag === "None" ||
          ready.value.application.id !== settings.applicationId ||
          ready.value.guilds.length !== 1 ||
          !ready.value.guilds.some((guild) => guild.id === settings.guildId)
        ) {
          return yield* Effect.fail(
            new DiscordUnavailable({ reason: "identity" }),
          );
        }
        yield* Console.log("development Discord ready");
        return yield* Effect.never;
      }).pipe(
        Effect.scoped,
        Effect.provide(services),
        Effect.ensuring(Console.log("development Discord stopped")),
      );
      return { run };
    }),
  );
