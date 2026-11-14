import { readFileSync } from "node:fs";
import { expect, it } from "@effect/vitest";
import { DiscordConfig, DiscordRESTMemoryLive } from "dfx";
import { ConfigProvider, Effect, Layer, Redacted } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { openAITextLive } from "../src/adapters/ai.ts";
import { createReportsDiscordLayer } from "../src/adapters/intake-discord.ts";
import { intakePostgresLayer } from "../src/adapters/intake-postgres.ts";
import { Intake } from "../src/capabilities/moderation/contract.ts";
import { IntakeLive } from "../src/capabilities/moderation/intake.ts";
import {
  ConfigurationStore,
  GuildAccess,
  IntakeStore,
} from "../src/capabilities/moderation/ports.ts";

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
      const providerBodies: {
        messages: { role: string; content: unknown }[];
      }[] = [];
      const format = fault.startsWith("ai-") ? fault.slice(3) : "pdf";
      const supported =
        fault.startsWith("ai-") ||
        ["none-pdf", "five", "budget", "rejection"].includes(fault);
      const fixture = readFileSync(
        new URL(
          `../../../evaluations/fixtures/attachments/distribution.${format}`,
          import.meta.url,
        ),
      );
      const original =
        fault === "budget" ? new Uint8Array(15 * 1024 * 1024) : fixture;
      if (fault === "budget") original.set(fixture);
      const mediaType =
        format === "pdf"
          ? "application/pdf"
          : format === "jpg"
            ? "image/jpeg"
            : `image/${format}`;
      const originals: Blob[] = [];
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
        return new Response(supported ? original : "hello");
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
              if (request.body._tag === "FormData")
                originals.push(request.body.formData.get("files[0]") as Blob);
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
        openAITextLive({
          modelId: "gpt-6-luna",
          fetch: async (_url, init) => {
            providerBodies.push(JSON.parse(String(init?.body)));
            if (fault === "rejection")
              return Response.json(
                { error: { message: "secret provider diagnostics" } },
                { status: 400 },
              );
            return Response.json({
              id: "r",
              object: "chat.completion",
              created: 0,
              model: "gpt-6-luna",
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: JSON.stringify({
                      action: ["none", "none-pdf"].includes(fault)
                        ? "none"
                        : "ban",
                      reason: "Platform presumption.",
                      offendingUrls: [],
                    }),
                  },
                  finish_reason: "stop",
                },
              ],
            });
          },
        }).pipe(
          Layer.provide(
            ConfigProvider.layer(
              ConfigProvider.fromUnknown({
                HERO_AI_API_KEY: "controlled",
                HERO_AI_MODEL: "gpt-6-luna",
              }),
            ),
          ),
        ),
      );
      yield* Effect.gen(function* () {
        const intake = yield* Intake;
        const store = yield* IntakeStore;
        let attachments: (
          | (typeof attachment & { content_type?: string })
          | null
        )[] =
          fault === "invalid"
            ? [null]
            : fault === "host"
              ? [{ ...attachment, url: "https://example.com/course" }]
              : [{ ...attachment, size: fault === "oversized" ? 20971521 : 5 }];
        if (supported) {
          attachments = [
            {
              ...attachment,
              filename: `distribution.${format}`,
              content_type: mediaType,
              size: original.byteLength,
            },
          ];
          if (fault === "five")
            attachments = Array.from({ length: 5 }, (_, n) => ({
              ...attachment,
              filename: `distribution.${format}`,
              content_type: mediaType,
              size: original.byteLength,
              id: String(n),
            }));
          if (fault === "budget")
            attachments.push({
              ...attachment,
              id: "b",
              url: attachment.url + "?b",
              size: 6 * 1024 * 1024,
              content_type: "application/octet-stream",
            });
        }
        const e = { ...evidence, attachments };
        expect(yield* intake.receive(e)).toBe(expected);
        expect(yield* intake.receive(e)).toBe("duplicate");
        const retained = yield* store.read("10", "100");
        const expectedRecord = ["none", "none-pdf", "rejection"].includes(fault)
          ? []
          : [
              {
                record: { evidence: { attachments } },
                delivery:
                  fault === "thread"
                    ? { rootId: "root", threadId: "", state: "partial" }
                    : {
                        state: expected === "reported" ? "complete" : "partial",
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
        const specialRecord =
          fault === "five"
            ? [
                {
                  delivery: {
                    attachments: Array.from({ length: 5 }, () => ({
                      status: "available",
                    })),
                  },
                  record: {
                    evidence: {
                      attachmentInputs: [
                        { status: "supplied" },
                        { status: "supplied" },
                        { status: "supplied" },
                        { status: "supplied" },
                        { status: "unavailable", reason: "content-limit" },
                      ],
                    },
                  },
                },
              ]
            : fault === "budget"
              ? [
                  {
                    delivery: {
                      attachments: [
                        { status: "available" },
                        { status: "oversized" },
                      ],
                    },
                    record: {
                      evidence: {
                        attachmentInputs: [
                          { status: "supplied" },
                          {
                            status: "unavailable",
                            reason: "unsupported-format",
                          },
                        ],
                      },
                    },
                  },
                ]
              : expectedRecord;
        expect(retained).toMatchObject(specialRecord);
        expect(providerBodies).toHaveLength(1);
        const body = JSON.stringify(providerBodies);
        expect(
          body.includes(
            "data:" +
              mediaType +
              ";base64," +
              Buffer.from(original).toString("base64"),
          ),
        ).toBe(supported);
        expect(body).toContain("untrusted data");
        expect(body).not.toContain('"tools"');
        expect(body).not.toContain('"image_url":{"url":"https:');
        expect(JSON.stringify(retained)).not.toContain(
          Buffer.from(fixture).toString("base64"),
        );
        const copiedBytes = yield* Effect.promise(() =>
          Promise.all(
            originals
              .filter(() => fault.startsWith("ai-"))
              .map(async (b) => new Uint8Array(await b.arrayBuffer())),
          ),
        );
        expect(copiedBytes).toEqual(
          fault.startsWith("ai-") ? [new Uint8Array(fixture)] : [],
        );
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

it.effect.each(["png", "jpg", "gif", "webp", "pdf"])(
  "original %s bytes reach installed provider and private copy once without PostgreSQL blobs",
  (format) => scenario("ai-" + format, "reported", "available"),
);
it.effect(
  "AI inspects a harmless PDF transiently without archiving ordinary contents",
  () => scenario("none-pdf", "none", "pending"),
);
it.effect("four AI contents and five private originals remain distinct", () =>
  scenario("five", "reported", "available"),
);
it.effect("AI and preservation cannot spend separate download budgets", () =>
  scenario("budget", "failed", "oversized"),
);
it.effect(
  "provider attachment rejection is a service failure without a member finding",
  () => scenario("rejection", "failed", "pending"),
);
