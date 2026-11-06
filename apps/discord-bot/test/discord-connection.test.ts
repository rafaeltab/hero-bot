import { expect, it } from "@effect/vitest";
import {
  ConfigProvider,
  Console,
  Deferred,
  type Duration,
  Effect,
  Fiber,
  Layer,
} from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { CurrentLoggers, make as makeLogger } from "effect/Logger";
import { MinimumLogLevel } from "effect/References";
import * as Socket from "effect/socket/Socket";
import { discordDevelopmentLayer } from "../src/adapters/discord-development.ts";
import { developmentProgram } from "../src/application.ts";
import { DiscordUnavailable } from "../src/capabilities/discord-connection/contract.ts";

const settings = {
  HERO_ENV: "development",
  DEV_DISCORD_BOT_TOKEN: "offline-secret",
  DEV_DISCORD_APPLICATION_ID: "123",
  DEV_DISCORD_GUILD_ID: "456",
};

// External transport simulator: dfx itself handles HELLO, IDENTIFY and READY.
class GatewaySocket extends EventTarget implements Socket.WebSocketLike {
  readyState = 0;
  closed = false;
  identified: unknown[] = [];
  requests: string[] = [];
  guilds = [{ id: "456", unavailable: true }];
  applicationId = "123";
  sendReady = true;
  open() {
    setTimeout(() => {
      this.readyState = 1;
      this.dispatchEvent(new Event("open"));
      setTimeout(
        () => this.receive({ op: 10, d: { heartbeat_interval: 60_000 } }),
        0,
      );
    }, 0);
  }
  receive(payload: unknown) {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(payload) }),
    );
  }
  send(data: string | Uint8Array<ArrayBuffer>) {
    const payload = JSON.parse(String(data));
    this.identified.push(payload);
    if (payload.op === 2 && this.sendReady) {
      setTimeout(
        () =>
          this.receive({
            op: 0,
            t: "READY",
            s: 1,
            d: {
              v: 10,
              application: { id: this.applicationId, flags: 0 },
              user: { id: "789" },
              guilds: this.guilds,
              session_id: "offline-session",
              resume_gateway_url: "wss://offline.invalid",
            },
          }),
        0,
      );
    }
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
}

const connect = (
  socket: GatewaySocket,
  config: Record<string, string> = settings,
  timeout: Duration.Input = "15 seconds",
  stallHttp = false,
) =>
  developmentProgram.pipe(
    Effect.provide(discordDevelopmentLayer(timeout)),
    Effect.provide(
      Layer.succeed(Socket.WebSocketConstructor, () => {
        socket.open();
        return socket;
      }),
    ),
    Effect.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) => {
          socket.requests.push(request.url);
          if (stallHttp) return Effect.never;
          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response(
                JSON.stringify({
                  url: "wss://offline.invalid",
                  shards: 1,
                  session_start_limit: {
                    total: 100,
                    remaining: 100,
                    reset_after: 0,
                    max_concurrency: 1,
                  },
                }),
              ),
            ),
          );
        }),
      ),
    ),
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(config))),
  );

it.live(
  "connects through installed dfx, observes READY and closes the socket on interruption",
  () =>
    Effect.gen(function* () {
      const socket = new GatewaySocket();
      const ready = yield* Deferred.make<void>();
      const messages: unknown[] = [];
      const sdkLogs: string[] = [];
      const fiber = yield* connect(socket).pipe(
        Effect.provideService(Console.Console, {
          ...console,
          log: (message) => {
            messages.push(message);
            Deferred.doneUnsafe(ready, Effect.void);
          },
        }),
        Effect.provideService(MinimumLogLevel, "Trace"),
        Effect.provideService(
          CurrentLoggers,
          new Set([
            makeLogger((entry) => {
              sdkLogs.push(JSON.stringify(entry.message));
            }),
          ]),
        ),
        Effect.forkChild,
      );
      yield* Deferred.await(ready).pipe(Effect.timeout("3 seconds"));
      yield* Fiber.interrupt(fiber);
      expect(messages).toEqual([
        "development Discord ready",
        "development Discord stopped",
      ]);
      expect(socket.closed).toBe(true);
      expect(sdkLogs.join("\n")).not.toContain("offline-secret");
      expect(socket.requests).toEqual([
        "https://discord.com/api/v10/gateway/bot",
      ]);
      expect(socket.identified).toContainEqual(
        expect.objectContaining({
          op: 2,
          d: expect.objectContaining({ token: "offline-secret", intents: 1 }),
        }),
      );
    }),
);

it.live(
  "rejects a bot belonging to any server beyond its separate development server",
  () =>
    Effect.gen(function* () {
      const socket = new GatewaySocket();
      socket.guilds.push({ id: "999", unavailable: true });
      const failure = yield* connect(socket).pipe(Effect.flip);
      expect(failure).toEqual(new DiscordUnavailable({ reason: "identity" }));
      expect(socket.closed).toBe(true);
    }),
);

it.live.each([
  {},
  { ...settings, HERO_ENV: "production" },
  { ...settings, DEV_DISCORD_BOT_TOKEN: "" },
  { ...settings, DEV_DISCORD_APPLICATION_ID: "invalid" },
  { ...settings, DEV_DISCORD_APPLICATION_ID: "x123" },
  { ...settings, DEV_DISCORD_APPLICATION_ID: "123x" },
  { ...settings, DEV_DISCORD_GUILD_ID: "x456" },
  { ...settings, DEV_DISCORD_GUILD_ID: "456x" },
  { ...settings, DEV_DISCORD_GUILD_ID: "" },
])("rejects invalid development configuration before dialing: %j", (config) =>
  Effect.gen(function* () {
    const socket = new GatewaySocket();
    const failure = yield* connect(socket, config).pipe(Effect.flip);
    expect(failure).toEqual(
      new DiscordUnavailable({ reason: "configuration" }),
    );
    expect(socket.readyState).toBe(0);
    expect(socket.requests).toEqual([]);
    expect(JSON.stringify(failure)).not.toContain("offline-secret");
    expect(failure.message).toBe(
      "Development Discord unavailable (configuration)",
    );
  }),
);

it.live.each(["application", "server"])(
  "rejects a mismatched development %s and releases resources",
  (mismatch) =>
    Effect.gen(function* () {
      const socket = new GatewaySocket();
      socket.applicationId = mismatch === "application" ? "999" : "123";
      socket.guilds = mismatch === "server" ? [] : socket.guilds;
      const failure = yield* connect(socket).pipe(Effect.flip);
      expect(failure).toEqual(new DiscordUnavailable({ reason: "identity" }));
      expect(socket.closed).toBe(true);
    }),
);

it.live(
  "bounds missing READY with a sanitized connection error and closes the transport",
  () =>
    Effect.gen(function* () {
      const socket = new GatewaySocket();
      socket.sendReady = false;
      const failure = yield* connect(socket, settings, "50 millis").pipe(
        Effect.flip,
      );
      expect(failure).toEqual(new DiscordUnavailable({ reason: "connection" }));
      expect(socket.closed).toBe(true);
      expect(socket.identified).toContainEqual(
        expect.objectContaining({ op: 2 }),
      );
    }),
);

it.live(
  "bounds stalled SDK REST initialization before opening a WebSocket",
  () =>
    Effect.gen(function* () {
      const socket = new GatewaySocket();
      const failure = yield* connect(socket, settings, "50 millis", true).pipe(
        Effect.flip,
      );
      expect(failure).toEqual(new DiscordUnavailable({ reason: "connection" }));
      expect(socket.requests).toEqual([
        "https://discord.com/api/v10/gateway/bot",
      ]);
      expect(socket.readyState).toBe(0);
    }),
);

it.live(
  "rejects exactly one unexpected guild and releases the connection",
  () =>
    Effect.gen(function* () {
      const socket = new GatewaySocket();
      socket.guilds = [{ id: "999", unavailable: true }];
      const failure = yield* connect(socket).pipe(
        Effect.timeout("1 second"),
        Effect.flip,
      );
      expect(failure).toEqual(new DiscordUnavailable({ reason: "identity" }));
      expect(socket.closed).toBe(true);
    }),
);
