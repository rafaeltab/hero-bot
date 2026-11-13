// Explicit operator action: metadata GETs only; never retries copies or downloads sources.
import { NodeHttpClient } from "@effect/platform-node";
import { DiscordConfig, DiscordRESTMemoryLive } from "dfx";
import { ConfigProvider, Effect, Layer } from "effect";
import { reportsDiscordLayer } from "../dist/adapters/intake-discord.js";
import { intakePostgresLayer } from "../dist/adapters/intake-postgres.js";
import { moderationSettings } from "../dist/adapters/moderation-runtime.js";
import { IntakeStore, Reports } from "../dist/capabilities/moderation/ports.js";

const [guild, message] = process.argv.slice(2);
if (!/^[1-9]\d*$/.test(guild ?? "") || !/^[1-9]\d*$/.test(message ?? ""))
  throw Error("Usage: check-attachment-copies.mjs <guild-id> <message-id>");
const program = Effect.scoped(
  Effect.gen(function* () {
    const settings = yield* moderationSettings;
    if (!settings.guildIds.includes(guild)) throw Error("Unconfigured server");
    const discord = reportsDiscordLayer.pipe(
      Layer.provide(DiscordRESTMemoryLive),
      Layer.provide(DiscordConfig.layer({ token: settings.token })),
      Layer.provide(NodeHttpClient.layerUndici),
    );
    yield* Effect.gen(function* () {
      const store = yield* IntakeStore;
      const reports = yield* Reports;
      const records = yield* store.read(guild, message);
      for (const entry of records) {
        if (!entry.delivery) continue;
        const updated = yield* reports.refresh(entry.delivery);
        yield* store.delivered(entry.record.evidence, updated);
        // Deliberately output only availability, no original names, URLs, text or errors.
        console.log(
          JSON.stringify({
            version: entry.record.evidence.version,
            state: updated.state ?? "unknown",
            attachments: updated.attachments?.map((a) => ({
              id: a.sourceAttachmentId,
              status: a.status,
              checkedAt: a.checkedAt,
            })),
          }),
        );
      }
    }).pipe(Effect.provide(Layer.merge(discord, intakePostgresLayer())));
  }),
).pipe(
  Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv())),
  Effect.catch(() =>
    Effect.sync(() => {
      console.error(
        "Attachment availability check failed; verify private access and database configuration.",
      );
      process.exitCode = 1;
    }),
  ),
);
await Effect.runPromise(program);
