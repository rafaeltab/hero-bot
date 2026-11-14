import { expect, it } from "@effect/vitest";
import { DiscordConfig, DiscordRESTMemoryLive } from "dfx";
import { Effect, Layer, Redacted } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { handleModerationInteraction } from "../src/adapters/moderation-commands.ts";
import {
  Intake,
  Moderation,
  ModerationUnavailable,
  type Request,
} from "../src/capabilities/moderation/contract.ts";

const event = (data: unknown) => ({
  id: "1",
  application_id: "123",
  token: "private-token",
  type: 2,
  guild_id: "10",
  channel_id: "20",
  member: { user: { id: "11" } },
  data,
});
const submission = (name: string, options: unknown[] = []) =>
  event({
    name: "moderation",
    options: [{ name: "config", options: [{ name, options }] }],
  });
const run = (input: unknown, reply = "done", fail = false) =>
  Effect.gen(function* () {
    const requests: Request[] = [];
    const files: File[] = [];
    const responses: { method: string; url: string; body: string }[] = [];
    yield* handleModerationInteraction(input).pipe(
      Effect.provide(
        Layer.succeed(Moderation, {
          execute: (r) => {
            requests.push(r);
            return fail
              ? Effect.fail(new ModerationUnavailable({ reason: "database" }))
              : Effect.succeed(reply);
          },
        }),
      ),
      Effect.provide(DiscordRESTMemoryLive),
      Effect.provide(DiscordConfig.layer({ token: Redacted.make("secret") })),
      Effect.provide(
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((r) => {
            if (r.body._tag === "FormData") {
              const file = r.body.formData.get("files[0]");
              if (file instanceof File) files.push(file);
            }
            responses.push({
              method: r.method,
              url: r.url,
              body:
                r.body._tag === "Uint8Array"
                  ? new TextDecoder().decode(r.body.body)
                  : r.body._tag,
            });
            return Effect.succeed(
              HttpClientResponse.fromWeb(r, new Response("{}")),
            );
          }),
        ),
      ),
    );
    return { requests, responses, files };
  });
it.effect.each([
  [
    submission("prompt", [{ name: "value", value: "Policy" }]),
    { kind: "prompt", value: "Policy" },
  ],
  [
    submission("role", [
      { name: "group", value: "Admin" },
      { name: "role", value: "50" },
      { name: "remove", value: true },
    ]),
    { kind: "role", group: "Admin", roleId: "50", remove: true },
  ],
  [
    submission("role", [
      { name: "group", value: "Owner" },
      { name: "role", value: "50" },
    ]),
    { kind: "role", group: "Owner", roleId: "50", remove: false },
  ],
  [
    submission("role", [
      { name: "group", value: "Moderator" },
      { name: "role", value: "50" },
    ]),
    { kind: "role", group: "Moderator", roleId: "50", remove: false },
  ],
  [
    submission("channel", [
      { name: "purpose", value: "auditChannel" },
      { name: "channel", value: "20" },
    ]),
    { kind: "channel", purpose: "auditChannel", channelId: "20" },
  ],
  [
    submission("channel", [
      { name: "purpose", value: "reportingChannel" },
      { name: "channel", value: "20" },
    ]),
    { kind: "channel", purpose: "reportingChannel", channelId: "20" },
  ],
  [
    submission("unmap", [
      { name: "group", value: "Moderator" },
      { name: "role-id", value: "52" },
    ]),
    { kind: "role", group: "Moderator", roleId: "52", remove: true },
  ],
  [submission("history"), { kind: "history" }],
  [
    event({
      name: "channel-status",
      options: [{ name: "channel", value: "21" }],
    }),
    { kind: "status", channelId: "21" },
  ],
  [event({ name: "channel-status" }), { kind: "status", channelId: "20" }],
  [event({ name: "doctor" }), { kind: "doctor" }],
])(
  "decodes Discord submission into the server-scoped workflow: %j",
  ([input, command]) =>
    Effect.gen(function* () {
      const { requests, responses } = yield* run(input);
      expect(requests).toEqual([{ guildId: "10", actorId: "11", command }]);
      expect(JSON.parse(responses[0]?.body ?? "{}")).toMatchObject({
        type: 5,
        data: { flags: 64 },
      });
      expect(JSON.parse(responses[1]?.body ?? "{}")).toMatchObject({
        content: expect.stringContaining("done"),
        allowed_mentions: { parse: [] },
      });
    }),
);
it.effect.each([
  event({ name: "unknown" }),
  event({ name: "moderation" }),
  event({ name: "moderation", options: [{ name: "wrong" }] }),
  event({ name: "moderation", options: [{ name: "config" }] }),
  submission("unknown"),
  submission("prompt"),
  submission("role", [
    { name: "group", value: "course" },
    { name: "role", value: "50" },
  ]),
  submission("role", [{ name: "group", value: "Admin" }]),
  submission("channel", [
    { name: "purpose", value: "unknown" },
    { name: "channel", value: "20" },
  ]),
  submission("channel"),
])(
  "explains malformed or unsupported Discord commands privately: %j",
  (input) =>
    Effect.gen(function* () {
      const { requests, responses } = yield* run(input);
      expect(requests).toEqual([]);
      expect(responses.at(-1)?.body).toContain("Invalid configuration command");
    }),
);
it.effect.each([
  {},
  { ...event({ name: "doctor" }), type: 1 },
  { ...event({ name: "doctor" }), guild_id: undefined },
])("ignores non-guild-command events without reading messages: %j", (input) =>
  Effect.gen(function* () {
    expect(yield* run(input)).toEqual({
      requests: [],
      responses: [],
      files: [],
    });
  }),
);
it.effect(
  "private database failure replies contain recovery guidance rather than raw errors",
  () =>
    Effect.gen(function* () {
      const { responses } = yield* run(submission("show"), "ignored", true);
      expect(responses.at(-1)?.body).toContain("No change confirmed");
      expect(responses.at(-1)?.body).not.toContain("ModerationUnavailable");
    }),
);
it.effect(
  "large policy history is returned as a private file instead of silently truncated text",
  () =>
    Effect.gen(function* () {
      const { responses, files } = yield* run(
        submission("history"),
        "history".repeat(1000),
      );
      expect(responses.at(-1)?.body).toBe("FormData");
      expect(
        yield* Effect.promise(() => files[0]?.text() ?? Promise.resolve("")),
      ).toBe("history".repeat(1000));
    }),
);

it.effect.each([
  "done",
  "Denied: current Owner/Admin or Moderator permission required.",
])("service counts are private and follow status authorization: %s", (reply) =>
  Effect.gen(function* () {
    const { responses } = yield* run(event({ name: "doctor" }), reply).pipe(
      Effect.provide(
        Layer.succeed(Intake, {
          receive: () => Effect.die("unused"),
          reportFailure: () => Effect.void,
          recover: () => Effect.void,
          status: () =>
            Effect.succeed({
              since: "startup",
              missedMessages: 7,
              active: ["judgment"],
              failures: { judgment: 7 },
            }),
        }),
      ),
    );
    expect(responses.at(-1)?.body.includes("missed messages 7")).toBe(
      reply === "done",
    );
    expect(JSON.parse(responses[0]?.body ?? "{}")).toMatchObject({
      type: 5,
      data: { flags: 64 },
    });
  }),
);

it.effect.each([
  "guild",
  "shared",
  "unconfigured",
  "accounting-unavailable",
  "available",
] as const)(
  "private diagnostics explain current budget %s without notifying or invoking AI",
  (reason) =>
    Effect.gen(function* () {
      const guilds: string[] = [];
      const { responses, files } = yield* run(
        event({ name: "doctor" }),
        "readiness",
      ).pipe(
        Effect.provide(
          Layer.succeed(Intake, {
            receive: () => Effect.die("no judgment"),
            reportFailure: () => Effect.die("no notification"),
            recover: () => Effect.die("no mutation"),
            status: (guild) => {
              guilds.push(guild);
              return Effect.succeed({
                since: "startup",
                missedMessages: 0,
                active: [],
                failures: {},
                budget:
                  reason === "accounting-unavailable"
                    ? { reason }
                    : {
                        reason,
                        day: "2026-11-14",
                        timezone: "UTC",
                        guild: {
                          reportedMicroUsd: 0,
                          heldMicroUsd: 60,
                          unknownAttempts: 1,
                        },
                        shared: {
                          reportedMicroUsd: 0,
                          heldMicroUsd: 60,
                          unknownAttempts: 1,
                        },
                        policy: {
                          version: "test",
                          pricing: "test",
                          model: "gpt-6-luna",
                          guildMicroUsd: { "10": 100 },
                          sharedMicroUsd: 150,
                          inputMicroUsdPerMillion: 1000000,
                          outputMicroUsdPerMillion: 2000000,
                          maxInputTokens: 40,
                          maxOutputTokens: 10,
                        },
                      },
              });
            },
          }),
        ),
      );
      const text = files[0]
        ? yield* Effect.promise(() => files[0]?.text() ?? Promise.resolve(""))
        : responses.at(-1)?.body;
      expect(text).toContain(
        reason === "available" ? "capacity available" : reason,
      );
      expect(text).toContain("provider connectivity unverified");
      expect(text).toContain("Historical loss before process start unknown");
      expect(guilds).toEqual(["10"]);
    }),
);

it.effect("failed authorization lookup never discloses service state", () =>
  Effect.gen(function* () {
    const { responses } = yield* run(
      event({ name: "doctor" }),
      "ignored",
      true,
    ).pipe(
      Effect.provide(
        Layer.succeed(Intake, {
          status: () => Effect.die("must not disclose service status"),
          receive: () => Effect.die("unused"),
          reportFailure: () => Effect.void,
          recover: () => Effect.void,
        }),
      ),
    );
    expect(responses.at(-1)?.body).toContain("ERROR setup unavailable");
    expect(responses.at(-1)?.body).not.toContain("missed messages");
  }),
);
