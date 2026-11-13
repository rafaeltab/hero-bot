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
          if (judgment.action === "none") return "none" as const;
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
          yield* store.save(record);
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
          const delivery = yield* reports.publish(record, (progress) =>
            store.delivered(e, progress),
          );
          yield* store.delivered(e, delivery);
          if (delivery.state === "partial")
            return yield* Effect.fail(
              new ModerationUnavailable({ reason: "discord" }),
            );
          return "reported" as const;
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
