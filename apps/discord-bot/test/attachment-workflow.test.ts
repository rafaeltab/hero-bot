import { expect, it } from "@effect/vitest";
import { DiscordConfig, DiscordRESTMemoryLive } from "dfx";
import { Effect, Layer, Redacted } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { createReportsDiscordLayer } from "../src/adapters/intake-discord.ts";
import { intakePostgresLayer } from "../src/adapters/intake-postgres.ts";
import { Intake } from "../src/capabilities/moderation/contract.ts";
import { IntakeLive } from "../src/capabilities/moderation/intake.ts";
import {
  ConfigurationStore,
  GuildAccess,
  IntakeStore,
} from "../src/capabilities/moderation/ports.ts";
import { TextGeneration } from "../src/capabilities/text-generation/contract.ts";
import {
  configurationDatabase,
  databaseConfig,
} from "./support/configuration-database.ts";
import { configuration, evidence } from "./support/intake-fixture.ts";

const attachment = {
  id: "a",
  filename: "original.txt",
  size: 5,
  url: "https://cdn.discordapp.com/attachments/20/a/original.txt",
};
const scenario = (fault: string, expected: string, status: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const table = yield* configurationDatabase;
      let downloads = 0;
      const requests: string[] = [];
      const transport: typeof fetch = async () => {
        downloads++;
        if (fault === "download")
          return new Response("deleted", { status: 404 });
        if (fault === "network") throw Error("secret source diagnostics");
        if (fault === "stream")
          return new Response(
            new ReadableStream({
              start(c) {
                c.enqueue(new Uint8Array(20 * 1024 * 1024));
                c.enqueue(new Uint8Array(1));
                c.close();
              },
            }),
          );
        return new Response("hello");
      };
      const reports = createReportsDiscordLayer(transport).pipe(
        Layer.provide(DiscordRESTMemoryLive),
        Layer.provide(DiscordConfig.layer({ token: Redacted.make("secret") })),
        Layer.provide(
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make((request) => {
              requests.push(`${request.method} ${request.url}`);
              const upload = request.body._tag === "FormData";
              const failed =
                (upload && fault === "upload") ||
                (request.url.endsWith("/threads") && fault === "thread");
              return Effect.succeed(
                HttpClientResponse.fromWeb(
                  request,
                  new Response(
                    JSON.stringify(
                      failed
                        ? { message: "secret diagnostics" }
                        : {
                            id: request.url.endsWith("/threads")
                              ? "thread"
                              : upload
                                ? "copy"
                                : "root",
                            attachments:
                              fault === "ack"
                                ? []
                                : [
                                    {
                                      id: "copied",
                                      filename: "original.txt",
                                      size: 5,
                                      url: "https://cdn.discordapp.com/attachments/thread/copied/original.txt",
                                    },
                                  ],
                          },
                    ),
                    { status: failed ? 403 : 200 },
                  ),
                ),
              );
            }),
          ),
        ),
      );
      const external = Layer.mergeAll(
        reports,
        intakePostgresLayer(table).pipe(Layer.provide(databaseConfig)),
        Layer.succeed(ConfigurationStore, {
          history: () => Effect.succeed([configuration]),
          save: () => Effect.die("unused"),
        }),
        Layer.succeed(GuildAccess, {
          inspect: () =>
            Effect.succeed({
              ownerId: "owner",
              actorRoles: [],
              roles: [],
              channels: [{ id: "30", private: true, usable: true }],
              problems: [],
            }),
        }),
        Layer.succeed(TextGeneration, {
          generate: () =>
            Effect.succeed(
              JSON.stringify({
                action: fault === "none" ? "none" : "ban",
                reason: "Platform presumption.",
                offendingUrls: [],
              }),
            ),
        }),
      );
      yield* Effect.gen(function* () {
        const intake = yield* Intake;
        const store = yield* IntakeStore;
        const attachments =
          fault === "invalid"
            ? [null]
            : fault === "host"
              ? [{ ...attachment, url: "https://example.com/course" }]
              : [{ ...attachment, size: fault === "oversized" ? 20971521 : 5 }];
        const e = { ...evidence, attachments };
        expect(yield* intake.receive(e)).toBe(expected);
        expect(yield* intake.receive(e)).toBe("duplicate");
        const retained = yield* store.read("10", "100");
        const expectedRecord =
          fault === "none"
            ? []
            : [
                {
                  record: { evidence: { attachments } },
                  delivery:
                    fault === "thread"
                      ? { rootId: "root", threadId: "", state: "partial" }
                      : {
                          state:
                            expected === "reported" ? "complete" : "partial",
                          attachments: [
                            {
                              status,
                              sourceMessageId: "100",
                              sourceVersion: evidence.version,
                            },
                          ],
                        },
                },
              ];
        expect(retained).toMatchObject(expectedRecord);
        expect(downloads).toBe(
          ["none", "thread", "invalid", "host", "oversized"].includes(fault)
            ? 0
            : 1,
        );
        expect(
          requests.every(
            (r) => r.startsWith("POST ") && !/bans|roles|DELETE/.test(r),
          ),
        ).toBe(true);
        const before = requests.length;
        // Another acquisition of the database service after workflow completion cannot replay.
        yield* Effect.gen(function* () {
          const restarted = yield* IntakeStore;
          expect(yield* restarted.claim(e)).toBe(false);
          expect(yield* restarted.read("10", "100")).toEqual(retained);
        }).pipe(
          Effect.provide(intakePostgresLayer(table)),
          Effect.provide(databaseConfig),
        );
        expect(requests.length).toBe(before);
      }).pipe(
        Effect.provide(IntakeLive.pipe(Layer.provide(external))),
        Effect.provide(external),
      );
    }),
  );

it.effect(
  "workflow retains copied attachment references across restart without depending on the source",
  () => scenario("ok", "reported", "available"),
);
it.effect("deleted source is explicit incomplete preservation", () =>
  scenario("download", "failed", "unavailable"),
);
it.effect("failed download does not leak transport diagnostics", () =>
  scenario("network", "failed", "unavailable"),
);
it.effect("oversized original is omitted without a download", () =>
  scenario("oversized", "failed", "oversized"),
);
it.effect("dishonest size cannot bypass the streamed download budget", () =>
  scenario("stream", "failed", "oversized"),
);
it.effect("linked sites are never attachment download targets", () =>
  scenario("host", "failed", "unavailable"),
);
it.effect("invalid metadata is an explicit omission", () =>
  scenario("invalid", "failed", "unavailable"),
);
it.effect("failed private upload remains uncertain and is not retried", () =>
  scenario("upload", "failed", "upload-unknown"),
);
it.effect(
  "missing attachment acknowledgment is never successful preservation",
  () => scenario("ack", "failed", "upload-unknown"),
);
it.effect("failed thread retains the partial report root identity", () =>
  scenario("thread", "failed", "pending"),
);
it.effect("ordinary none messages never download or retain attachments", () =>
  scenario("none", "none", "pending"),
);
