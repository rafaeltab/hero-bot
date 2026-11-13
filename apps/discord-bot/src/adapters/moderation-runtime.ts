import { DiscordConfig } from "dfx";
import { DiscordGateway, DiscordLive } from "dfx/gateway";
import {
  Config,
  Console,
  Effect,
  Layer,
  Redacted,
  Schema,
  Stream,
} from "effect";
import { ModerationUnavailable } from "../capabilities/moderation/contract.ts";
import {
  handleModerationInteraction,
  registerModerationCommands,
} from "./moderation-commands.ts";

const snowflake = Schema.String.check(Schema.isPattern(/^[1-9]\d*$/));
export const moderationSettings = Effect.gen(function* () {
  const environment = yield* Config.Literals(
    ["development", "production"],
    "HERO_ENV",
  );
  const prefix = environment === "development" ? "DEV" : "PROD";
  const token = yield* Config.String(`${prefix}_DISCORD_BOT_TOKEN`);
  const applicationId = yield* Config.schema(
    snowflake,
    `${prefix}_DISCORD_APPLICATION_ID`,
  );
  const guilds = yield* Config.String(`${prefix}_MODERATION_GUILD_IDS`);
  const guildIds = guilds.split(",").map((id) => id.trim());
  const other = environment === "development" ? "PROD" : "DEV";
  const otherApplication = yield* Config.String(
    `${other}_DISCORD_APPLICATION_ID`,
  ).pipe(Config.withDefault(""));
  const otherToken = yield* Config.String(`${other}_DISCORD_BOT_TOKEN`).pipe(
    Config.withDefault(""),
  );
  if (applicationId === otherApplication || token === otherToken)
    return yield* Effect.fail(
      new ModerationUnavailable({ reason: "configuration" }),
    );
  if (
    !token.trim() ||
    guildIds.length === 0 ||
    !guildIds.every((id) => /^[1-9]\d*$/.test(id)) ||
    new Set(guildIds).size !== guildIds.length
  )
    return yield* Effect.fail(
      new ModerationUnavailable({ reason: "configuration" }),
    );
  return { token: Redacted.make(token), applicationId, guildIds };
}).pipe(
  Effect.mapError(() => new ModerationUnavailable({ reason: "configuration" })),
);

export const moderationDiscordLayer = (token: Redacted.Redacted<string>) =>
  DiscordLive.pipe(
    Layer.provide(
      DiscordConfig.layer({ token, gateway: { intents: 1 | 512 | 32768 } }),
    ),
  );
export const awaitModerationReady = (
  applicationId: string,
  guildIds: readonly string[],
) =>
  Effect.gen(function* () {
    const gateway = yield* DiscordGateway;
    const ready = yield* Stream.runHead(gateway.fromDispatch("READY")).pipe(
      Effect.timeout("15 seconds"),
      Effect.mapError(() => new ModerationUnavailable({ reason: "discord" })),
    );
    if (
      ready._tag === "None" ||
      ready.value.application.id !== applicationId ||
      ready.value.guilds.some((g) => !guildIds.includes(g.id))
    )
      return yield* Effect.fail(
        new ModerationUnavailable({ reason: "identity" }),
      );
    return ready.value.user.id;
  });
export const runModerationCommands = (
  applicationId: string,
  guildIds: readonly string[],
) =>
  Effect.gen(function* () {
    const gateway = yield* DiscordGateway;
    const events = yield* Stream.toQueue(
      gateway.fromDispatch("INTERACTION_CREATE"),
      { capacity: "unbounded" },
    );
    for (const guildId of guildIds)
      yield* registerModerationCommands(applicationId, [guildId]).pipe(
        Effect.catch(() =>
          Console.log(
            "moderation server command registration blocked; check application scope and server access",
          ),
        ),
      );
    yield* Console.log(
      "notification-only configuration ready; creation/edit judgment and attachment preservation available; context/AI attachment contents unavailable",
    );
    return yield* Stream.mapEffect(
      Stream.fromQueue(events),
      (event) => {
        if (
          !("guild_id" in event) ||
          !event.guild_id ||
          !guildIds.includes(event.guild_id)
        )
          return Effect.void;
        return handleModerationInteraction(event).pipe(
          Effect.catch(() =>
            Console.log("moderation private response failed; retry command"),
          ),
        );
      },
      { concurrency: "unbounded", unordered: true },
    ).pipe(Stream.runDrain);
  });
