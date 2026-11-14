import { expect, it } from "@effect/vitest";
import {
  ConfigProvider,
  Console,
  Deferred,
  Effect,
  Fiber,
  Layer,
} from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Socket from "effect/socket/Socket";
import {
  awaitModerationReady,
  moderationDiscordLayer,
  moderationSettings,
  runModerationCommands,
} from "../src/adapters/moderation-runtime.ts";
import { Moderation } from "../src/capabilities/moderation/contract.ts";

const settings = {
  HERO_ENV: "development",
  DEV_DISCORD_BOT_TOKEN: "offline-secret",
  DEV_DISCORD_APPLICATION_ID: "123",
  DEV_MODERATION_GUILD_IDS: "10,12",
};
it.effect.each([
  {},
  { ...settings, HERO_ENV: "other" },
  { ...settings, DEV_DISCORD_BOT_TOKEN: "" },
  { ...settings, DEV_MODERATION_GUILD_IDS: "" },
  { ...settings, DEV_MODERATION_GUILD_IDS: "10,10" },
  { ...settings, DEV_MODERATION_GUILD_IDS: "10,x" },
])("sanitizes invalid moderation startup settings: %j", (config) =>
  moderationSettings.pipe(
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(config))),
    Effect.flip,
    Effect.map((failure) => {
      expect(failure.reason).toBe("configuration");
      expect(JSON.stringify(failure)).not.toContain("offline-secret");
      return failure;
    }),
  ),
);
it.effect(
  "uses separate production names and permits a deliberate multi-server allowlist",
  () =>
    Effect.gen(function* () {
      const config = yield* moderationSettings;
      expect(config.guildIds).toEqual(["10", "12"]);
      expect(config.applicationId).toBe("999");
    }).pipe(
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            ...settings,
            HERO_ENV: "production",
            PROD_DISCORD_BOT_TOKEN: "production-placeholder",
            PROD_DISCORD_APPLICATION_ID: "999",
            PROD_MODERATION_GUILD_IDS: "10,12",
          }),
        ),
      ),
    ),
);

class Gateway extends EventTarget implements Socket.WebSocketLike {
  readyState = 0;
  closed = false;
  ready = true;
  applicationId = "123";
  guilds = [{ id: "10" }, { id: "12" }];
  sequence = 0;
  receive(t: string, d: unknown) {
    this.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ op: 0, t, s: ++this.sequence, d }),
      }),
    );
  }
  open() {
    setTimeout(() => {
      this.readyState = 1;
      this.dispatchEvent(new Event("open"));
      setTimeout(
        () =>
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({
                op: 10,
                d: { heartbeat_interval: 60000 },
              }),
            }),
          ),
        0,
      );
    }, 0);
  }
  send(data: string | Uint8Array<ArrayBuffer>) {
    const payload = JSON.parse(String(data));
    if (payload.op === 2 && this.ready)
      setTimeout(
        () =>
          this.receive("READY", {
            v: 10,
            application: { id: this.applicationId, flags: 0 },
            user: { id: "99" },
            guilds: this.guilds,
            session_id: "offline",
            resume_gateway_url: "wss://offline.invalid",
          }),
        0,
      );
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
}
const transport = (
  socket: Gateway,
  requests: string[],
  failRegistration = false,
) =>
  Layer.mergeAll(
    Layer.succeed(Socket.WebSocketConstructor, () => {
      socket.open();
      return socket;
    }),
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) => {
        requests.push(request.url);
        if (failRegistration && request.url.includes("/guilds/10/commands"))
          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response(
                JSON.stringify({ message: "secret-error", code: 50001 }),
                { status: 403 },
              ),
            ),
          );
        const body = request.url.endsWith("/gateway/bot")
          ? {
              url: "wss://offline.invalid",
              shards: 1,
              session_start_limit: {
                total: 100,
                remaining: 100,
                reset_after: 0,
                max_concurrency: 1,
              },
            }
          : {};
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response(JSON.stringify(body)),
          ),
        );
      }),
    ),
  );
it.live(
  "multi-server dfx runtime isolates failed server registration and closes gateway after interruption",
  () =>
    Effect.gen(function* () {
      const socket = new Gateway();
      const requests: string[] = [];
      const logs: string[] = [];
      const started = yield* Deferred.make<void>();
      const answered = yield* Deferred.make<void>();
      const observed: string[] = [];
      const fiber = yield* Effect.scoped(
        Effect.gen(function* () {
          const config = yield* moderationSettings;
          const discord = yield* Layer.build(
            moderationDiscordLayer(config.token),
          );
          expect(
            yield* awaitModerationReady(
              config.applicationId,
              config.guildIds,
            ).pipe(Effect.provide(discord)),
          ).toBe("99");
          return yield* runModerationCommands(
            config.applicationId,
            config.guildIds,
          ).pipe(Effect.provide(discord));
        }),
      ).pipe(
        Effect.provide(transport(socket, requests, true)),
        Effect.provide(
          ConfigProvider.layer(ConfigProvider.fromUnknown(settings)),
        ),
        Effect.provideService(Console.Console, {
          ...console,
          log: (value) => {
            logs.push(String(value));
            if (String(value).includes("ready"))
              Deferred.doneUnsafe(started, Effect.void);
          },
        }),
        Effect.provide(
          Layer.succeed(Moderation, {
            execute: (request) => {
              observed.push(request.guildId);
              if (request.guildId === "10") return Effect.never;
              Deferred.doneUnsafe(answered, Effect.void);
              return Effect.succeed("private");
            },
          }),
        ),
        Effect.forkChild,
      );
      yield* Deferred.await(started).pipe(
        Effect.timeout("3 seconds"),
        Effect.catch(() =>
          Effect.die(new Error(JSON.stringify({ logs, requests }))),
        ),
      );
      yield* Effect.yieldNow;
      const event = {
        id: "1",
        application_id: "123",
        token: "private-token",
        type: 2,
        guild_id: "12",
        channel_id: "20",
        member: { user: { id: "11" } },
        data: { name: "channel-status" },
      };
      socket.receive("INTERACTION_CREATE", { ...event, guild_id: "999" });
      socket.receive("INTERACTION_CREATE", {
        ...event,
        id: "2",
        token: "other-private-token",
        guild_id: "10",
      });
      socket.receive("INTERACTION_CREATE", event);
      yield* Deferred.await(answered).pipe(
        Effect.timeout("3 seconds"),
        Effect.catch(() =>
          Effect.die(new Error(JSON.stringify({ logs, requests, observed }))),
        ),
      );
      yield* Fiber.interrupt(fiber);
      expect(socket.closed).toBe(true);
      expect(observed).toEqual(["10", "12"]);
      expect(logs.join(" ")).toContain("registration blocked");
      expect(logs.join(" ")).not.toContain("secret");
      expect(requests.some((url) => url.includes("/guilds/12/commands"))).toBe(
        true,
      );
      expect(requests.some((url) => url.includes("/guilds/999/"))).toBe(false);
    }),
);
it.live.each(["application", "guild"])(
  "rejects mismatched moderation %s identity and closes socket",
  (mismatch) =>
    Effect.gen(function* () {
      const socket = new Gateway();
      if (mismatch === "application") socket.applicationId = "999";
      else socket.guilds = [{ id: "999" }];
      const failure = yield* Effect.scoped(
        Effect.gen(function* () {
          const config = yield* moderationSettings;
          const discord = yield* Layer.build(
            moderationDiscordLayer(config.token),
          );
          return yield* awaitModerationReady(
            config.applicationId,
            config.guildIds,
          ).pipe(Effect.provide(discord));
        }),
      ).pipe(
        Effect.provide(transport(socket, [])),
        Effect.provide(
          ConfigProvider.layer(ConfigProvider.fromUnknown(settings)),
        ),
        Effect.flip,
      );
      expect(failure.reason).toBe("identity");
      expect(socket.closed).toBe(true);
    }),
);

it.effect(
  "rejects an explicitly reused development/production application identity",
  () =>
    moderationSettings.pipe(
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            ...settings,
            PROD_DISCORD_APPLICATION_ID: "123",
          }),
        ),
      ),
      Effect.flip,
      Effect.map((e) => {
        expect(e.reason).toBe("configuration");
        return e;
      }),
    ),
);
