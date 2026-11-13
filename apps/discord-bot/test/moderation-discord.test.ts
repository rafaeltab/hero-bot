import { expect, it } from "@effect/vitest";
import { DiscordConfig, DiscordRESTMemoryLive } from "dfx";
import { Effect, Layer, Redacted } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { guildAccessLayer } from "../src/adapters/moderation-discord.ts";
import { GuildAccess } from "../src/capabilities/moderation/ports.ts";

it.effect(
  "reads actual guild roles and private channel overwrites using real dfx REST",
  () => {
    const urls: string[] = [];
    return Effect.gen(function* () {
      const discord = yield* GuildAccess;
      const access = yield* discord.inspect("10", "11", {
        Owner: [],
        Admin: [],
        Moderator: ["50"],
      });
      expect(access.ownerId).toBe("11");
      expect(access.channels).toEqual([
        { id: "20", private: true, usable: true },
      ]);
      expect(
        urls.every((url) => !url.includes("ban") && !url.includes("messages")),
      ).toBe(true);
    }).pipe(
      Effect.provide(guildAccessLayer("99")),
      Effect.provide(DiscordRESTMemoryLive),
      Effect.provide(DiscordConfig.layer({ token: Redacted.make("secret") })),
      Effect.provide(
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) => {
            urls.push(request.url);
            let body: unknown = { owner_id: "11" };
            if (request.url.endsWith("/roles"))
              body = [
                { id: "10", permissions: "0" },
                { id: "50", permissions: "66560" },
                {
                  id: "60",
                  permissions: "343597485056",
                  tags: { bot_id: "99" },
                },
              ];
            if (request.url.includes("/members/"))
              body = { roles: request.url.endsWith("/99") ? ["60"] : ["50"] };
            if (request.url.endsWith("/channels"))
              body = [
                {
                  id: "20",
                  guild_id: "10",
                  type: 0,
                  permission_overwrites: [
                    { id: "10", type: 0, deny: "1024", allow: "0" },
                    { id: "60", type: 0, deny: "0", allow: "343597485056" },
                    { id: "50", type: 0, deny: "0", allow: "1024" },
                  ],
                },
              ];
            return Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                new Response(JSON.stringify(body)),
              ),
            );
          }),
        ),
      ),
    );
  },
);

import {
  handleModerationInteraction,
  registerModerationCommands,
} from "../src/adapters/moderation-commands.ts";
import { Moderation } from "../src/capabilities/moderation/contract.ts";

it.effect(
  "registers real Discord commands and privately defers then answers config submissions",
  () => {
    const calls: { method: string; url: string; body: unknown }[] = [];
    return Effect.gen(function* () {
      yield* registerModerationCommands("123", ["10", "12"]);
      yield* handleModerationInteraction({
        id: "1",
        token: "interaction-secret",
        application_id: "123",
        type: 2,
        guild_id: "10",
        channel_id: "20",
        member: { user: { id: "11" } },
        data: {
          name: "moderation",
          options: [{ name: "config", options: [{ name: "show" }] }],
        },
      });
      expect(calls.map((c) => c.method)).toEqual([
        "POST",
        "POST",
        "POST",
        "POST",
        "POST",
        "POST",
        "POST",
        "PATCH",
      ]);
      expect(calls[6]?.body).toMatchObject({ type: 5, data: { flags: 64 } });
      expect(calls[7]?.body).toMatchObject({
        content: "private policy",
        allowed_mentions: { parse: [] },
      });
    }).pipe(
      Effect.provide(
        Layer.succeed(Moderation, {
          execute: () => Effect.succeed("private policy"),
        }),
      ),
      Effect.provide(DiscordRESTMemoryLive),
      Effect.provide(DiscordConfig.layer({ token: Redacted.make("secret") })),
      Effect.provide(
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) => {
            const body =
              request.body._tag === "Uint8Array"
                ? JSON.parse(new TextDecoder().decode(request.body.body))
                : {};
            calls.push({ method: request.method, url: request.url, body });
            return Effect.succeed(
              HttpClientResponse.fromWeb(request, new Response("{}")),
            );
          }),
        ),
      ),
    );
  },
);

it.effect(
  "a shared ordinary bot role must not be treated as a private moderator recipient",
  () =>
    Effect.gen(function* () {
      const access = yield* GuildAccess;
      expect(
        (yield* access.inspect("10", "11", {
          Owner: [],
          Admin: [],
          Moderator: [],
        })).channels,
      ).toEqual([{ id: "20", private: false, usable: true }]);
    }).pipe(
      Effect.provide(guildAccessLayer("99")),
      Effect.provide(DiscordRESTMemoryLive),
      Effect.provide(DiscordConfig.layer({ token: Redacted.make("secret") })),
      Effect.provide(
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) => {
            let body: unknown = { owner_id: "11" };
            if (request.url.endsWith("/roles"))
              body = [
                { id: "10", permissions: "0" },
                { id: "60", permissions: "343597485056" },
              ];
            if (request.url.includes("/members/")) body = { roles: ["60"] };
            if (request.url.endsWith("/channels"))
              body = [
                {
                  id: "20",
                  guild_id: "10",
                  type: 0,
                  permission_overwrites: [],
                },
              ];
            return Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                new Response(JSON.stringify(body)),
              ),
            );
          }),
        ),
      ),
    ),
);

it.effect(
  "blocks configured channels when a mapped moderator cannot read the evidence",
  () =>
    Effect.gen(function* () {
      const access = yield* GuildAccess;
      expect(
        (yield* access.inspect("10", "11", {
          Owner: [],
          Admin: [],
          Moderator: ["50"],
        })).channels,
      ).toEqual([{ id: "20", private: true, usable: false }]);
    }).pipe(
      Effect.provide(guildAccessLayer("99")),
      Effect.provide(DiscordRESTMemoryLive),
      Effect.provide(DiscordConfig.layer({ token: Redacted.make("secret") })),
      Effect.provide(
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) => {
            let body: unknown = { owner_id: "11" };
            if (request.url.endsWith("/roles"))
              body = [
                { id: "10", permissions: "0" },
                { id: "50", permissions: "0" },
                {
                  id: "60",
                  permissions: "343597485056",
                  tags: { bot_id: "99" },
                },
              ];
            if (request.url.includes("/members/")) body = { roles: ["60"] };
            if (request.url.endsWith("/channels"))
              body = [
                {
                  id: "20",
                  guild_id: "10",
                  type: 0,
                  permission_overwrites: [],
                },
              ];
            return Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                new Response(JSON.stringify(body)),
              ),
            );
          }),
        ),
      ),
    ),
);

it.effect.each([
  {
    name: "ordinary member grant",
    botPermissions: "343597485056",
    channel: {
      id: "20",
      guild_id: "10",
      type: 0,
      permission_overwrites: [{ id: "77", type: 1, allow: "1024", deny: "0" }],
    },
    expected: [{ id: "20", private: false, usable: true }],
    problems: [],
  },
  {
    name: "bot member deny",
    botPermissions: "343597485056",
    channel: {
      id: "20",
      guild_id: "10",
      type: 0,
      permission_overwrites: [{ id: "99", type: 1, allow: "0", deny: "1024" }],
    },
    expected: [{ id: "20", private: true, usable: false }],
    problems: [],
  },
  {
    name: "bot administrator",
    botPermissions: "8",
    channel: { id: "20", guild_id: "10", type: 0, permission_overwrites: [] },
    expected: [{ id: "20", private: true, usable: false }],
    problems: [
      "Remove Administrator from the bot; grant explicit channel permissions.",
    ],
  },
  {
    name: "foreign channel",
    botPermissions: "343597485056",
    channel: { id: "20", guild_id: "12", type: 0, permission_overwrites: [] },
    expected: [],
    problems: [],
  },
  {
    name: "DM channel",
    botPermissions: "343597485056",
    channel: { id: "20", type: 1 },
    expected: [],
    problems: [],
  },
])("real REST access diagnostics for $name", (fixture) =>
  Effect.gen(function* () {
    const discord = yield* GuildAccess;
    const result = yield* discord.inspect("10", "11", {
      Owner: [],
      Admin: [],
      Moderator: [],
    });
    expect(result.channels).toEqual(fixture.expected);
    expect(result.problems).toEqual(fixture.problems);
  }).pipe(
    Effect.provide(guildAccessLayer("99")),
    Effect.provide(DiscordRESTMemoryLive),
    Effect.provide(DiscordConfig.layer({ token: Redacted.make("secret") })),
    Effect.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) => {
          let body: unknown = { owner_id: "11" };
          if (request.url.endsWith("/roles"))
            body = [
              { id: "10", permissions: "0" },
              {
                id: "60",
                permissions: fixture.botPermissions,
                tags: { bot_id: "99" },
              },
            ];
          if (request.url.includes("/members/")) body = { roles: ["60"] };
          if (request.url.endsWith("/channels")) body = [fixture.channel];
          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response(JSON.stringify(body)),
            ),
          );
        }),
      ),
    ),
  ),
);
it.effect(
  "sanitizes actual Discord REST access failure without retaining the private response",
  () =>
    Effect.gen(function* () {
      const discord = yield* GuildAccess;
      const failure = yield* discord
        .inspect("10", "11", { Owner: [], Admin: [], Moderator: [] })
        .pipe(Effect.flip);
      expect(failure.reason).toBe("discord");
      expect(JSON.stringify(failure)).not.toContain("secret");
    }).pipe(
      Effect.provide(guildAccessLayer("99")),
      Effect.provide(DiscordRESTMemoryLive),
      Effect.provide(DiscordConfig.layer({ token: Redacted.make("secret") })),
      Effect.provide(
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                new Response(
                  JSON.stringify({ message: "secret-error", code: 50001 }),
                  { status: 403 },
                ),
              ),
            ),
          ),
        ),
      ),
    ),
);

it.effect(
  "channel status can inspect an existing thread omitted from guild channel listings",
  () =>
    Effect.gen(function* () {
      const discord = yield* GuildAccess;
      const result = yield* discord.inspect(
        "10",
        "11",
        { Owner: [], Admin: [], Moderator: [] },
        "25",
      );
      expect(result.channels).toEqual([
        { id: "25", private: false, usable: false },
      ]);
    }).pipe(
      Effect.provide(guildAccessLayer("99")),
      Effect.provide(DiscordRESTMemoryLive),
      Effect.provide(DiscordConfig.layer({ token: Redacted.make("secret") })),
      Effect.provide(
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) => {
            let body: unknown = { owner_id: "11" };
            if (request.url.endsWith("/roles"))
              body = [{ id: "10", permissions: "0" }];
            if (request.url.includes("/members/")) body = { roles: [] };
            if (request.url.endsWith("/channels")) body = [];
            if (request.url.endsWith("/channels/25"))
              body = { id: "25", guild_id: "10", type: 11, parent_id: "20" };
            return Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                new Response(JSON.stringify(body)),
              ),
            );
          }),
        ),
      ),
    ),
);
