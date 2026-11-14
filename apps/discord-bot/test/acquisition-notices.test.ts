import { expect, it } from "@effect/vitest";
import { DiscordConfig, DiscordRESTMemoryLive } from "dfx";
import { Effect, Layer, Redacted } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { reportsDiscordLayer } from "../src/adapters/intake-discord.ts";
import { handleMessageUpdate } from "../src/adapters/intake-events.ts";
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

it.effect.each(["unavailable", "version-mismatch"])(
  "acquisition %s sends a private service notice through dfx without a member report",
  (fault) =>
    Effect.scoped(
      Effect.gen(function* () {
        const table = yield* configurationDatabase;
        const requests: { method: string; url: string; body: string }[] = [];
        let privateRoute = true;
        const event = {
          guild_id: "10",
          id: "100",
          channel_id: "20",
          edited_timestamp: evidence.version,
        };
        yield* Effect.gen(function* () {
          const intake = yield* Intake;
          // Initially unsafe routes cannot receive even a service notice. After permissions
          // change, a new failure must revalidate and retry rather than remain suppressed.
          privateRoute = false;
          yield* handleMessageUpdate(event, ["10"]);
          privateRoute = true;
          yield* handleMessageUpdate(event, ["10"]);
          yield* handleMessageUpdate(event, ["10"]);
          yield* handleMessageUpdate({ ...event, guild_id: "other" }, ["10"]);
          expect(yield* intake.status("10")).toMatchObject({
            missedMessages: 3,
            active: ["evidence"],
          });
          expect(yield* intake.status("other")).toMatchObject({
            missedMessages: 0,
            active: [],
          });
          expect(yield* (yield* IntakeStore).read("10", "100")).toEqual([]);
          const posts = requests.filter((r) => r.method === "POST");
          expect(posts).toHaveLength(1);
          expect(posts[0]).toMatchObject({
            url: expect.stringContaining("/channels/30/messages"),
            body: expect.stringContaining("Moderation service failure"),
          });
          expect(posts[0]?.body).not.toContain("Automatic report");
          expect(posts[0]?.body).not.toContain("PRIVATE SOURCE CONTENT");
          expect(posts[0]?.body).toContain('"parse":[]');
          expect(
            requests.every((r) => r.method === "GET" || r.method === "POST"),
          ).toBe(true);
        }).pipe(
          Effect.provide(IntakeLive),
          Effect.provide(intakePostgresLayer(table)),
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(ConfigurationStore, {
                history: (guild) =>
                  Effect.succeed(guild === "10" ? [configuration] : []),
                save: () => Effect.die("unused"),
              }),
              Layer.succeed(GuildAccess, {
                inspect: (guild) =>
                  Effect.succeed({
                    ownerId: "11",
                    actorRoles: [],
                    roles: [],
                    channels:
                      guild === "10"
                        ? [{ id: "30", private: privateRoute, usable: true }]
                        : [],
                    problems: [],
                  }),
              }),
              Layer.succeed(TextGeneration, {
                generate: () =>
                  Effect.die("acquisition failures must not judge"),
              }),
            ),
          ),
          Effect.provide(reportsDiscordLayer),
          Effect.provide(DiscordRESTMemoryLive),
          Effect.provide(
            DiscordConfig.layer({ token: Redacted.make("secret") }),
          ),
          Effect.provide(
            Layer.succeed(
              HttpClient.HttpClient,
              HttpClient.make((request) => {
                requests.push({
                  method: request.method,
                  url: request.url,
                  body:
                    request.body._tag === "Uint8Array"
                      ? new TextDecoder().decode(request.body.body)
                      : "",
                });
                return Effect.succeed(
                  HttpClientResponse.fromWeb(
                    request,
                    Response.json(
                      request.method === "GET"
                        ? {
                            id: "100",
                            channel_id: "20",
                            edited_timestamp: "different",
                            content: "PRIVATE SOURCE CONTENT",
                          }
                        : { id: "notice" },
                      {
                        status:
                          request.method === "GET" && fault === "unavailable"
                            ? 403
                            : 200,
                      },
                    ),
                  ),
                );
              }),
            ),
          ),
          Effect.provide(databaseConfig),
        );
      }),
    ),
);
