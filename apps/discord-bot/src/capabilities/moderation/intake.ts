import { Console, Effect, Layer } from "effect";
import { TextGeneration } from "../text-generation/contract.ts";
import {
  type FailureStage,
  Intake,
  ModerationUnavailable,
  type RecordEntry,
  type ServiceHealth,
} from "./contract.ts";
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
    const since = new Date().toISOString();
    const health = new Map<string, ServiceHealth>();
    const snapshot = (guild: string): ServiceHealth =>
      health.get(guild) ?? {
        since,
        missedMessages: 0,
        failures: {},
        active: [],
      };
    const recover = (guild: string, stage: FailureStage) =>
      Effect.sync(() => {
        const current = snapshot(guild);
        health.set(guild, {
          ...current,
          active: current.active.filter((s) => s !== stage),
        });
      });
    const recordFailure = (
      guild: string,
      stage: FailureStage,
      missed: boolean,
    ) => {
      const current = snapshot(guild);
      const first = !current.active.includes(stage);
      health.set(guild, {
        ...current,
        missedMessages: current.missedMessages + Number(missed),
        failures: {
          ...current.failures,
          [stage]: (current.failures[stage] ?? 0) + 1,
        },
        active: first ? [...current.active, stage] : current.active,
      });
      return first;
    };
    const reportFailure = (
      guild: string,
      channel: string | null,
      stage: FailureStage,
      missed = false,
    ) =>
      Effect.gen(function* () {
        if (!recordFailure(guild, stage, missed)) return;
        yield* reports
          .notify(guild, channel, structuredClone(snapshot(guild)))
          .pipe(
            Effect.catch(() =>
              Console.log(
                `moderation service notification failed; guild=${guild}; stage=${stage}; missed=${snapshot(guild).missedMessages}; inspect private service readiness`,
              ),
            ),
          );
      });
    const context = yield* Effect.serviceOption(EvidenceContext);

    return Intake.of({
      status: (guild) => Effect.sync(() => structuredClone(snapshot(guild))),
      reportFailure,
      recover,
      receive: (e) => {
        let channel: string | null = null;
        let stage: FailureStage = "configuration";
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
          stage = "database";
          if (!(yield* store.claim(e))) return "duplicate" as const;
          stage = "evidence";
          const source = { ...e, currentRoles: a.actorRoles };
          const supplied =
            context._tag === "Some"
              ? yield* context.value.acquire(source)
              : source;
          const systemPrompt = `${judgmentInstructions}\n${config.prompt}`;
          stage = "judgment";
          const raw = yield* ai.generate(
            JSON.stringify(supplied),
            systemPrompt,
            { guildId: e.guildId, purpose: "judgment" },
          );
          const judgment = yield* Effect.try({
            try: () => parseJudgment(raw),
            catch: () => new ModerationUnavailable({ reason: "configuration" }),
          });
          yield* recover(e.guildId, "judgment");
          yield* recover(e.guildId, "configuration");
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
          stage = "database";
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
              stage = "report";
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
              stage = "report";
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
              stage = "database";
              yield* store.delivering(e);
              stage = "report";
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
              stage = "database";
              yield* store.delivered(e, published);
              stage = published.attachments?.some(
                (a) => a.status !== "available",
              )
                ? "evidence"
                : "report";
              if (published.state !== "complete")
                return yield* Effect.fail(
                  new ModerationUnavailable({ reason: "discord" }),
                );
              yield* recover(e.guildId, "database");
              yield* recover(e.guildId, "report");
              yield* recover(e.guildId, "evidence");
              return "reported" as const;
            }),
          );
        }).pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              recordFailure(e.guildId, stage, true);
            }),
          ),
          Effect.catch((error) =>
            reportFailure(
              e.guildId,
              channel,
              "reason" in error && error.reason === "database"
                ? "database"
                : stage,
              true,
            ).pipe(Effect.andThen(Effect.succeed("failed" as const))),
          ),
        );
      },
    });
  }),
);
