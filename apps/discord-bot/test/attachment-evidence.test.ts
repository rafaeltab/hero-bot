import { expect, it } from "@effect/vitest";
import { DiscordConfig, DiscordRESTMemoryLive } from "dfx";
import { Effect, Layer, Redacted } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { createReportsDiscordLayer } from "../src/adapters/intake-discord.ts";
import { Reports } from "../src/capabilities/moderation/ports.ts";
import { configuration, evidence } from "./support/intake-fixture.ts";

it.effect(
  "actionable evidence copies original bytes with durable source and copy identities",
  () => {
    const uploads: FormData[] = [];
    let mode = "available";
    let sourceDeleted = false;
    return Effect.gen(function* () {
      const reports = yield* Reports;
      const delivery = yield* reports.publish({
        evidence: {
          ...evidence,
          attachments: [
            {
              id: "a",
              filename: "original.txt",
              size: 5,
              url: "https://cdn.discordapp.com/attachments/20/100/original.txt",
            },
          ],
        },
        configuration,
        judgment: {
          action: "ban",
          reason: "Platform presumption.",
          offendingUrls: [],
        },
        model: "gpt-6-luna",
        provider: "openai/chat",
        assessedAt: "today",
      });
      expect(delivery.attachments).toMatchObject([
        {
          sourceAttachmentId: "a",
          status: "available",
          copy: { messageId: "copy", attachmentId: "copied" },
        },
      ]);
      sourceDeleted = true;
      expect((yield* reports.refresh(delivery)).attachments).toMatchObject([
        { status: "available" },
      ]);
      mode = "deleted";
      expect((yield* reports.refresh(delivery)).attachments).toMatchObject([
        { status: "missing" },
      ]);
      mode = "forbidden";
      expect((yield* reports.refresh(delivery)).attachments).toMatchObject([
        { status: "unavailable" },
      ]);
      mode = "missing-attachment";
      expect((yield* reports.refresh(delivery)).attachments).toMatchObject([
        { status: "missing" },
      ]);
      const original = uploads[0]?.get("files[0]") as Blob;
      expect(yield* Effect.promise(() => original.text())).toBe("hello");
    }).pipe(
      Effect.provide(
        createReportsDiscordLayer(
          async () =>
            new Response("hello", { status: sourceDeleted ? 404 : 200 }),
        ),
      ),
      Effect.provide(DiscordRESTMemoryLive),
      Effect.provide(DiscordConfig.layer({ token: Redacted.make("secret") })),
      Effect.provide(
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) => {
            if (request.body._tag === "FormData")
              uploads.push(request.body.formData);
            return Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                new Response(
                  JSON.stringify({
                    id: request.url.endsWith("/threads")
                      ? "thread"
                      : request.body._tag === "FormData"
                        ? "copy"
                        : "root",
                    attachments:
                      request.method === "GET" && mode === "missing-attachment"
                        ? []
                        : [
                            {
                              id: "copied",
                              filename: "original.txt",
                              size: 5,
                              url: "https://cdn.discordapp.com/attachments/thread/copy/original.txt",
                            },
                          ],
                  }),
                  {
                    status:
                      request.method === "GET" && mode === "deleted"
                        ? 404
                        : request.method === "GET" && mode === "forbidden"
                          ? 403
                          : 200,
                  },
                ),
              ),
            );
          }),
        ),
      ),
    );
  },
);

import { createAttachmentSession } from "../src/adapters/attachment-acquisition.ts";

const preservation = (budget: boolean) => {
  let downloads = 0;
  let uploads = 0;
  const session = createAttachmentSession(async () => {
    downloads++;
    return new Response(budget ? new Uint8Array(15 * 1024 * 1024) : "hello");
  });
  const url = "https://cdn.discordapp.com/attachments/20/a/original.txt";
  return Effect.gen(function* () {
    const reports = yield* Reports;
    // Future AI selection and preservation share exactly this session; no second budget.
    yield* Effect.promise(() =>
      session.acquire(url, budget ? 15 * 1024 * 1024 : 5),
    );
    const attachments = budget
      ? [
          { id: "a", filename: "a.bin", size: 15 * 1024 * 1024, url },
          {
            id: "b",
            filename: "b.bin",
            size: 6 * 1024 * 1024,
            url: `${url}?other`,
          },
        ]
      : ["a", "b", "c", "d", "e"].map((id) => ({
          id,
          filename: `${id}.txt`,
          size: 5,
          url,
        }));
    const result = yield* reports.publish(
      {
        evidence: { ...evidence, attachments },
        configuration,
        judgment: {
          action: "ban",
          reason: "Platform presumption.",
          offendingUrls: [],
        },
        model: "gpt-6-luna",
        provider: "openai/chat",
        assessedAt: "today",
      },
      undefined,
      session,
    );
    expect(result.attachments?.map((a) => a.status)).toEqual(
      budget
        ? ["available", "oversized"]
        : ["available", "available", "available", "available", "available"],
    );
    expect(downloads).toBe(1);
    expect(uploads).toBe(budget ? 1 : 5);
  }).pipe(
    Effect.provide(createReportsDiscordLayer()),
    Effect.provide(DiscordRESTMemoryLive),
    Effect.provide(DiscordConfig.layer({ token: Redacted.make("secret") })),
    Effect.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) => {
          if (request.body._tag === "FormData") uploads++;
          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response(
                JSON.stringify({
                  id: request.url.endsWith("/threads") ? "thread" : "root",
                  attachments: [
                    { id: "copied", filename: "original.txt", size: 5, url },
                  ],
                }),
              ),
            ),
          );
        }),
      ),
    ),
  );
};
it.effect(
  "AI selection and private copying share one cached 20 MiB acquisition budget",
  () => preservation(true),
);
it.effect(
  "preservation copies all originals even beyond the four AI-input selection limit",
  () => preservation(false),
);
