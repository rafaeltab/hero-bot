import { Console, Effect, Layer } from "effect";
import { TextGeneration } from "../text-generation/contract.ts";
import { Intake, ModerationUnavailable, type RecordEntry } from "./contract.ts";
import { judgmentInstructions, parseJudgment } from "./judgment.ts";
import {
  ConfigurationStore,
  EvidenceContext,
  GuildAccess,
  IntakeStore,
  Reports,
} from "./ports.ts";
export const IntakeLive = Layer.effect(
  Intake,
  Effect.gen(function* () {
    const configurations = yield* ConfigurationStore;
    const access = yield* GuildAccess;
    const store = yield* IntakeStore;
    const reports = yield* Reports;
    const ai = yield* TextGeneration;
    const context = yield* Effect.serviceOption(EvidenceContext);
    return Intake.of({
      receive: (e) => {
        let channel: string | null = null;
        return Effect.gen(function* () {
          const config = (yield* configurations.history(e.guildId)).at(-1);
          if (!config)
            return yield* Effect.fail(
              new ModerationUnavailable({ reason: "configuration" }),
            );
          const a = yield* access.inspect(
            e.guildId,
            e.authorId,
            config.roles,
            e.channelId,
          );
          const routes = [config.auditChannel, config.reportingChannel].filter(
            (x) => x !== null,
          );
          if (
            e.authorId === a.ownerId ||
            config.roles.Moderator.some((r) => a.actorRoles.includes(r)) ||
            routes.includes(e.channelId) ||
            (e.parentId !== null && routes.includes(e.parentId))
          )
            return "exempt" as const;
          const privateRoute = a.channels.find(
            (c) => c.id === config.auditChannel && c.private && c.usable,
          );
          if (!privateRoute || a.problems.length || !config.prompt.trim())
            return yield* Effect.fail(
              new ModerationUnavailable({ reason: "configuration" }),
            );
          channel = privateRoute.id;
          if (!(yield* store.claim(e))) return "duplicate" as const;
          const source = { ...e, currentRoles: a.actorRoles };
          const supplied =
            context._tag === "Some"
              ? yield* context.value.acquire(source)
              : source;
          const systemPrompt = `${judgmentInstructions}\n${config.prompt}`;
          const raw = yield* ai.generate(
            JSON.stringify(supplied),
            systemPrompt,
          );
          const judgment = yield* Effect.try({
            try: () => parseJudgment(raw),
            catch: () => new ModerationUnavailable({ reason: "configuration" }),
          });

          const record: RecordEntry = {
            evidence: supplied,
            systemPrompt,
            configuration: config,
            judgment,
            model: "gpt-6-luna",
            provider: "openai/chat",
            assessedAt: new Date().toISOString(),
            observedRoles: a.actorRoles,
          };
          return yield* store.serialize(
            e,
            Effect.gen(function* () {
              const prior = yield* store.read(e.guildId, e.messageId);
              if (judgment.action === "none" && prior.length === 0) {
                yield* store.assessed(e);
                return "none" as const;
              }
              yield* store.save(record);
              yield* store.assessed(e);
              const progress = yield* store.progress(e);
              if (progress.some((p) => p.state === "delivering"))
                return yield* Effect.fail(
                  new ModerationUnavailable({ reason: "discord" }),
                );
              const history = yield* store.read(e.guildId, e.messageId);
              const latest = history.at(-1)?.record ?? record;
              const original = history.find((h) => h.delivery !== null);
              const delivery = original?.delivery ?? null;
              channel =
                original?.delivery?.channelId ??
                original?.record.configuration.auditChannel ??
                channel;
              const fresh = yield* access.inspect(
                e.guildId,
                e.authorId,
                config.roles,
              );
              if (
                !fresh.channels.some(
                  (c) => c.id === channel && c.private && c.usable,
                ) ||
                fresh.problems.length
              ) {
                channel = null;
                return yield* Effect.fail(
                  new ModerationUnavailable({ reason: "discord" }),
                );
              }
              yield* store.delivering(e);
              const published = yield* reports.publish(
                record,
                (progress) => store.delivered(e, progress),
                undefined,
                {
                  delivery,
                  auditChannel: channel,
                  latest,
                  observedVersion: progress.at(-1)?.version ?? e.version,
                },
              );
              yield* store.delivered(e, published);
              if (published.state === "partial")
                return yield* Effect.fail(
                  new ModerationUnavailable({ reason: "discord" }),
                );
              return "reported" as const;
            }),
          );
        }).pipe(
          Effect.catch(() =>
            reports.notify(e.guildId, channel).pipe(
              Effect.catch(() =>
                Console.log(
                  "moderation service notification failed; inspect private service readiness",
                ),
              ),
              Effect.andThen(Effect.succeed("failed" as const)),
            ),
          ),
        );
      },
    });
  }),
);
