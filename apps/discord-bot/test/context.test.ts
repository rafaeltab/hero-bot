import { expect, it } from "@effect/vitest";
import { DiscordConfig, DiscordRESTMemoryLive } from "dfx";
import { Effect, Layer, Redacted } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { evidenceContextDiscordLayer } from "../src/adapters/evidence-context-discord.ts";
import {
  EvidenceContext,
  IntakeStore,
} from "../src/capabilities/moderation/ports.ts";
import { evidence } from "./support/intake-fixture.ts";

it.effect(
  "real dfx acquires bounded ancestors and nearby authors without following supplied URLs",
  () => {
    const requests: string[] = [];
    return Effect.gen(function* () {
      const context = yield* EvidenceContext;
      const result = yield* context.acquire({
        ...evidence,
        replyReference: { guild_id: "10", channel_id: "20", message_id: "99" },
      });
      expect(result.replyAncestors).toMatchObject([
        {
          messageId: "99",
          authorId: "13",
          text: "[copy](https://bilibili.com.example.org)",
        },
      ]);
      expect(result.nearbyMessages).toMatchObject([
        { messageId: "98", authorId: "14" },
      ]);
      expect(result.limitations.join(" ")).toContain("reply ancestor limit");
      expect(requests).toHaveLength(2);
      expect(
        requests.every((url) => url.includes("/channels/20/messages")),
      ).toBe(true);
    }).pipe(
      Effect.provide(
        evidenceContextDiscordLayer({ replies: 1, nearby: 1, history: 0 }),
      ),
      Effect.provide(Layer.succeed(IntakeStore, {} as never)),
      Effect.provide(DiscordRESTMemoryLive),
      Effect.provide(DiscordConfig.layer({ token: Redacted.make("secret") })),
      Effect.provide(
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) => {
            requests.push(request.url);
            const message = {
              id: "99",
              channel_id: "20",
              author: { id: "13" },
              timestamp: "2026-11-12T00:00:00Z",
              content: "[copy](https://bilibili.com.example.org)",
              message_reference: { message_id: "97", channel_id: "20" },
            };
            return Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                Response.json(
                  request.url.includes("/messages/99")
                    ? message
                    : [{ ...message, id: "98", author: { id: "14" } }],
                ),
              ),
            );
          }),
        ),
      ),
    );
  },
);

const contextScenario = (
  run: (
    c: typeof EvidenceContext.Service,
    requests: string[],
  ) => Effect.Effect<void, unknown>,
  options: {
    replies?: number;
    nearby?: number;
    history?: number;
    fault?: boolean;
    foreign?: boolean;
    cycle?: boolean;
    entries?: import("../src/capabilities/moderation/contract.ts").HistoryEntry[];
    historyFault?: boolean;
  } = {},
) => {
  const requests: string[] = [];
  return Effect.gen(function* () {
    yield* run(yield* EvidenceContext, requests);
  }).pipe(
    Effect.provide(
      evidenceContextDiscordLayer({
        replies: options.replies ?? 10,
        nearby: options.nearby ?? 20,
        history: options.history ?? 10,
      }),
    ),
    Effect.provide(
      Layer.succeed(IntakeStore, {
        memberHistory: () =>
          options.historyFault
            ? Effect.fail(new ModerationUnavailable({ reason: "database" }))
            : Effect.succeed(options.entries ?? []),
      } as never),
    ),
    Effect.provide(DiscordRESTMemoryLive),
    Effect.provide(DiscordConfig.layer({ token: Redacted.make("secret") })),
    Effect.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) => {
          requests.push(request.url);
          if (options.fault)
            return Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                Response.json(
                  { message: "Missing Access", code: 50001 },
                  { status: 403 },
                ),
              ),
            );
          const message = (id: string) => ({
            id,
            guild_id: options.foreign ? "other" : "10",
            channel_id: "20",
            author: { id: "13" },
            member: { roles: ["learner"] },
            timestamp: "2026-11-12T00:00:00Z",
            content: "",
            embeds: [],
            message_reference: {
              message_id: options.cycle ? id : String(Number(id) - 1),
            },
          });
          const id = request.url.split("/").at(-1) ?? "";
          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              Response.json(
                id === "messages"
                  ? Array.from({ length: 20 }, (_, i) =>
                      message(String(80 - i)),
                    )
                  : message(id),
              ),
            ),
          );
        }),
      ),
    ),
  );
};

import { ModerationUnavailable } from "../src/capabilities/moderation/contract.ts";

it.effect(
  "default bounds supply exactly ten ancestors, twenty nearby messages and ten current history findings",
  () =>
    contextScenario(
      (c) =>
        Effect.gen(function* () {
          const e = yield* c.acquire({
            ...evidence,
            replyReference: { message_id: "99" },
          });
          expect(e.replyAncestors).toHaveLength(10);
          expect(e.nearbyMessages).toHaveLength(20);
          expect(e.moderationHistory).toHaveLength(10);
          expect(e.replyAncestors?.[0]).toMatchObject({
            text: "",
            roles: ["learner"],
            authorId: "13",
          });
          expect(e.moderationHistory?.[0]).toMatchObject({
            status: "overturned",
            correction: "License verified",
            summary: "Authorized",
          });
          expect(e.limitations.join(" ")).toContain(
            "corrections resolved before selection",
          );
        }),
      {
        entries: Array.from({ length: 11 }, (_, i) => ({
          guildId: "10",
          authorId: "12",
          messageId: String(200 + i),
          at: `2026-11-${String(20 - i).padStart(2, "0")}T00:00:00Z`,
          origin: "manual",
          status: "overturned",
          summary: "Authorized",
          correction: "License verified",
          supportingEvidence: ["license"],
        })),
      },
    ),
);

it.effect(
  "inaccessible evidence and failed history are omissions rather than empty or clean-history findings",
  () =>
    contextScenario(
      (c) =>
        Effect.gen(function* () {
          const e = yield* c.acquire({
            ...evidence,
            replyReference: { message_id: "99" },
          });
          expect(e.replyAncestors).toEqual([]);
          expect(e.nearbyMessages).toEqual([]);
          expect(e.moderationHistory).toEqual([]);
          expect(e.limitations.join(" ")).toContain("not empty content");
          expect(e.limitations.join(" ")).toContain(
            "not a clean-history finding",
          );
        }),
      { fault: true, historyFault: true },
    ),
);

it.effect.each([
  { guild_id: "other", message_id: "99" },
  { channel_id: "audit", message_id: "99" },
  { message_id: "100" },
])(
  "foreign reference or cycle is rejected without fetching it: %j",
  (replyReference) =>
    contextScenario(
      (c, requests) =>
        Effect.gen(function* () {
          const e = yield* c.acquire({ ...evidence, replyReference });
          expect(e.replyAncestors).toEqual([]);
          expect(requests).toEqual([]);
          expect(e.limitations.join(" ")).toContain("rejected");
        }),
      { nearby: 0 },
    ),
);

it.effect(
  "foreign transport messages and foreign member history never enter supplied evidence",
  () =>
    contextScenario(
      (c) =>
        Effect.gen(function* () {
          const e = yield* c.acquire({
            ...evidence,
            replyReference: { message_id: "99" },
          });
          expect(e.replyAncestors).toEqual([]);
          expect(e.nearbyMessages).toEqual([]);
          expect(e.moderationHistory).toEqual([]);
          expect(e.limitations.join(" ")).toContain("History excluded");
        }),
      {
        foreign: true,
        entries: [
          {
            guildId: "other",
            authorId: "12",
            messageId: "200",
            at: "today",
            origin: "unknown",
            status: "pending",
            summary: "foreign",
            supportingEvidence: [],
          },
        ],
      },
    ),
);

it.effect(
  "cycles stop acquisition and zero history bound suppresses supplied entries",
  () =>
    contextScenario(
      (c, requests) =>
        Effect.gen(function* () {
          const e = yield* c.acquire({
            ...evidence,
            replyReference: { message_id: "99" },
          });
          expect(e.replyAncestors).toHaveLength(1);
          expect(e.moderationHistory).toEqual([]);
          expect(requests).toHaveLength(1);
        }),
      { cycle: true, nearby: 0, history: 0 },
    ),
);

import { ConfigProvider } from "effect";
import { contextBounds } from "../src/adapters/evidence-context-discord.ts";

it.effect.each(["-1", "11", "1.5"])(
  "invalid configured reply bound %s fails before intake",
  (value) =>
    Effect.gen(function* () {
      expect((yield* contextBounds.pipe(Effect.flip)).reason).toBe(
        "configuration",
      );
    }).pipe(
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({ HERO_CONTEXT_REPLIES: value }),
        ),
      ),
    ),
);

it.effect("operator can lower all context bounds independently", () =>
  Effect.gen(function* () {
    expect(yield* contextBounds).toEqual({ replies: 2, nearby: 3, history: 0 });
  }).pipe(
    Effect.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          HERO_CONTEXT_REPLIES: "2",
          HERO_CONTEXT_NEARBY: "3",
          HERO_CONTEXT_HISTORY: "0",
        }),
      ),
    ),
  ),
);
