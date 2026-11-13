import { expect, it } from "@effect/vitest";
import { DiscordConfig, DiscordREST, DiscordRESTMemoryLive } from "dfx";
import { Effect, Layer, Redacted } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { reportsDiscordLayer } from "../src/adapters/intake-discord.ts";
import { Reports } from "../src/capabilities/moderation/ports.ts";
import { configuration, evidence } from "./support/intake-fixture.ts";

it.effect(
  "real dfx posts Automatic report and complete evidence thread with mentions suppressed and no punishment requests",
  () => {
    const requests: { url: string; method: string; body: unknown }[] = [];
    return Effect.gen(function* () {
      const r = yield* Reports;
      const result = yield* r.publish({
        evidence,
        configuration,
        judgment: {
          action: "ban",
          reason: "Platform presumption.",
          offendingUrls: ["https://bilibili.com/video/1"],
        },
        model: "gpt-6-luna",
        provider: "openai/chat",
        assessedAt: "today",
      });
      expect(result).toEqual({
        rootId: "root",
        threadId: "thread",
        state: "complete",
      });
      expect(requests.map((r) => r.method)).toEqual(["POST", "POST", "POST"]);
      expect(requests[0]).toMatchObject({
        url: expect.stringContaining("/channels/30/messages"),
        body: {
          allowed_mentions: { parse: [] },
          content: expect.stringContaining("Execution: disabled"),
        },
      });
      expect(requests[1]?.url).toContain("/messages/root/threads");
      expect(JSON.stringify(requests[2]?.body)).toContain(
        "bilibili.com/video/1",
      );
    }).pipe(
      Effect.provide(reportsDiscordLayer),
      Effect.provide(DiscordRESTMemoryLive),
      Effect.provide(DiscordConfig.layer({ token: Redacted.make("secret") })),
      Effect.provide(
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) => {
            requests.push({
              url: request.url,
              method: request.method,
              body:
                request.body._tag === "Uint8Array"
                  ? JSON.parse(new TextDecoder().decode(request.body.body))
                  : null,
            });
            return Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                new Response(
                  JSON.stringify({
                    id: request.url.endsWith("/threads") ? "thread" : "root",
                  }),
                ),
              ),
            );
          }),
        ),
      ),
    );
  },
);

import { handleMessageCreation } from "../src/adapters/intake-events.ts";
import { Intake } from "../src/capabilities/moderation/contract.ts";

it.effect(
  "gateway message creation preserves source text, embeds and quote attribution, and ignores DMs and unconfigured servers",
  () => {
    const supplied: unknown[] = [];
    return Effect.gen(function* () {
      const event = {
        guild_id: "10",
        id: "100",
        channel_id: "20",
        timestamp: "today",
        content: "exact original",
        author: { id: "12" },
        member: { roles: ["course"] },
        embeds: [{ title: "display", url: "https://bilibili.com/1" }],
        referenced_message: { author: { id: "13" }, content: "quote" },
        attachments: [{ id: "attachment" }],
      };
      yield* handleMessageCreation(event, ["10"]);
      yield* handleMessageCreation({ ...event, guild_id: "other" }, ["10"]);
      yield* handleMessageCreation({ ...event, guild_id: undefined }, ["10"]);
      expect(supplied).toMatchObject([
        {
          text: "exact original",
          embeds: event.embeds,
          quotes: [event.referenced_message],
          attachments: event.attachments,
          version: "today",
          authorId: "12",
          roles: ["course"],
        },
      ]);
    }).pipe(
      Effect.provide(
        Layer.succeed(DiscordREST, {
          getChannel: () => Effect.succeed({ parent_id: null }),
        } as never),
      ),
      Effect.provide(
        Layer.succeed(Intake, {
          status: () => Effect.die("unused"),
          reportFailure: () => Effect.void,
          recover: () => Effect.void,
          receive: (e) =>
            Effect.sync(() => {
              supplied.push(e);
              return "none" as const;
            }),
        }),
      ),
    );
  },
);

it.effect(
  "long Unicode source text is delivered completely within Discord message limits",
  () => {
    const messages: string[] = [];
    const text = "😀".repeat(4000);
    return Effect.gen(function* () {
      const r = yield* Reports;
      yield* r.publish({
        evidence: { ...evidence, text },
        configuration,
        judgment: {
          action: "delete",
          reason: "Public mention.",
          offendingUrls: [],
        },
        model: "gpt-6-luna",
        provider: "openai/chat",
        assessedAt: "today",
      });
      expect(
        messages
          .slice(1)
          .every((m) => m.length <= 1800 && !/\p{Surrogate}/u.test(m)),
      ).toBe(true);
      expect(JSON.parse(messages.slice(1).join("")).evidence.text).toBe(text);
    }).pipe(
      Effect.provide(reportsDiscordLayer),
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
            if (request.url.endsWith("/messages")) messages.push(body.content);
            return Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                new Response(
                  JSON.stringify({
                    id: request.url.endsWith("/threads") ? "thread" : "root",
                  }),
                ),
              ),
            );
          }),
        ),
      ),
    );
  },
);

import { handleMessageUpdate } from "../src/adapters/intake-events.ts";

it.effect(
  "partial edit hydrates the exact Discord version and ignores stale snapshots, metadata updates and foreign guilds",
  () => {
    const supplied: unknown[] = [];
    const failures: unknown[] = [];
    const snapshot = {
      id: "100",
      channel_id: "20",
      timestamp: evidence.version,
      edited_timestamp: "2026-11-13T00:01:00Z",
      content: "edited original",
      author: { id: "12" },
      attachments: [],
    };
    return Effect.gen(function* () {
      const event = {
        guild_id: "10",
        id: "100",
        channel_id: "20",
        edited_timestamp: snapshot.edited_timestamp,
      };
      yield* handleMessageUpdate(event, ["10"]);
      yield* handleMessageUpdate({ ...snapshot, guild_id: "10", embeds: [] }, [
        "10",
      ]);
      yield* handleMessageUpdate(
        { ...event, edited_timestamp: evidence.version },
        ["10"],
      );
      yield* handleMessageUpdate({ ...event, edited_timestamp: null }, ["10"]);
      yield* handleMessageUpdate({ ...event, guild_id: "other" }, ["10"]);
      yield* handleMessageUpdate({ id: "100", channel_id: "20" }, ["10"]);
      expect(supplied).toMatchObject([
        { version: snapshot.edited_timestamp, text: "edited original" },
        { version: snapshot.edited_timestamp, text: "edited original" },
      ]);
      expect(supplied).toHaveLength(2);
      expect(failures).toEqual([["10", null, "evidence", true]]);
    }).pipe(
      Effect.provide(
        Layer.succeed(DiscordREST, {
          getMessage: () => Effect.succeed(snapshot),
          getChannel: () => Effect.succeed({ type: 0 }),
        } as never),
      ),
      Effect.provide(
        Layer.succeed(Intake, {
          status: () => Effect.die("unused"),
          reportFailure: (...args) =>
            Effect.sync(() => {
              failures.push(args);
            }),
          recover: () => Effect.void,
          receive: (e) =>
            Effect.sync(() => {
              supplied.push(e);
              return "none" as const;
            }),
        }),
      ),
    );
  },
);

it.effect(
  "real dfx updates the existing root with the newest assessment while appending an older completed version to its thread",
  () => {
    const requests: { method: string; url: string; body: unknown }[] = [];
    const record = {
      evidence,
      configuration: { ...configuration, auditChannel: "moved" },
      judgment: {
        action: "ban" as const,
        reason: "Presumption.",
        offendingUrls: [],
      },
      model: "gpt-6-luna",
      provider: "openai/chat",
      assessedAt: "today",
    };
    return Effect.gen(function* () {
      const result = yield* (yield* Reports).publish(
        record,
        undefined,
        undefined,
        {
          delivery: { rootId: "original", threadId: "thread" },
          latest: {
            ...record,
            evidence: {
              ...evidence,
              version: "2026-11-13T00:01:00Z",
              text: "allowed",
            },
            judgment: { action: "none", reason: "Allowed.", offendingUrls: [] },
          },
          observedVersion: "2026-11-13T00:02:00Z",
          auditChannel: "30",
        },
      );
      expect(result).toEqual({
        state: "complete",
        rootId: "original",
        threadId: "thread",
        channelId: "30",
      });
      expect(requests.map((r) => r.method)).toEqual(["PATCH", "POST"]);
      expect(requests[0]).toMatchObject({
        url: expect.stringContaining("/channels/30/messages/original"),
        body: {
          content: expect.stringContaining("Recommendation: none"),
          allowed_mentions: { parse: [] },
          flags: 4,
        },
      });
      expect(JSON.stringify(requests[0]?.body)).toContain(
        "Newest assessed source version: 2026-11-13T00:01:00Z",
      );
      expect(JSON.stringify(requests[0]?.body)).toContain(
        "Newest observed source version: 2026-11-13T00:02:00Z",
      );
      expect(requests[1]).toMatchObject({
        url: expect.stringContaining("/channels/thread/messages"),
        body: { content: expect.stringContaining('"action": "ban"') },
      });
    }).pipe(
      Effect.provide(reportsDiscordLayer),
      Effect.provide(DiscordRESTMemoryLive),
      Effect.provide(DiscordConfig.layer({ token: Redacted.make("secret") })),
      Effect.provide(
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) => {
            requests.push({
              method: request.method,
              url: request.url,
              body:
                request.body._tag === "Uint8Array"
                  ? JSON.parse(new TextDecoder().decode(request.body.body))
                  : null,
            });
            return Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                Response.json({ id: "original" }),
              ),
            );
          }),
        ),
      ),
    );
  },
);
