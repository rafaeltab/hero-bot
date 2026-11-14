import { Console, Effect, Layer } from "effect";
import { AiBudget } from "../ai-budget/contract.ts";
import { TextGeneration } from "../text-generation/contract.ts";
import { attachmentInputs } from "./attachment-inputs.ts";
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
import { translateAudit } from "./translation.ts";
export const IntakeLive = Layer.effect(
  Intake,
  Effect.gen(function* () {
    const configurations = yield* ConfigurationStore;
    const access = yield* GuildAccess;
    const store = yield* IntakeStore;
    const reports = yield* Reports;
    const ai = yield* TextGeneration;
    const budget = yield* Effect.serviceOption(AiBudget);
    const since = new Date().toISOString();
    const health = new Map<string, ServiceHealth>();
    const snapshot = (guild: string): ServiceHealth =>
      health.get(guild) ?? {
        since,
        missedMessages: 0,
        failures: {},
        active: [],
      };
    const notices = new Set<string>();
    const recover = (guild: string, stage: FailureStage) =>
      Effect.sync(() => {
        const current = snapshot(guild);
        notices.delete(JSON.stringify([guild, stage]));
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
      _channel: string | null,
      stage: FailureStage,
      missed = false,
    ) =>
      Effect.gen(function* () {
        recordFailure(guild, stage, missed);
        const key = JSON.stringify([guild, stage]);
        if (notices.has(key)) return;
        notices.add(key);
        yield* Effect.gen(function* () {
          const config = (yield* configurations.history(guild)).at(-1);
          if (!config)
            return yield* Effect.fail(
              new ModerationUnavailable({ reason: "configuration" }),
            );
          const fresh = yield* access.inspect(
            guild,
            config.actorId,
            config.roles,
          );
          // A caller's source or stale route never authorizes a service notice.
          const route = fresh.channels.find(
            (c) => c.id === config.auditChannel && c.private && c.usable,
          );
          if (!route || fresh.problems.length)
            return yield* Effect.fail(
              new ModerationUnavailable({ reason: "configuration" }),
            );
          yield* reports.notify(
            guild,
            route.id,
            structuredClone(snapshot(guild)),
          );
        }).pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              notices.delete(key);
            }),
          ),
          Effect.catch(() =>
            Effect.gen(function* () {
              notices.delete(key);
              yield* Console.log(
                `moderation service notification failed; guild=${guild}; stage=${stage}; missed=${snapshot(guild).missedMessages}; inspect private service readiness`,
              );
            }),
          ),
        );
      });
    const context = yield* Effect.serviceOption(EvidenceContext);

    return Intake.of({
      status: (guild) =>
        Effect.gen(function* () {
          const health = structuredClone(snapshot(guild));
          if (budget._tag === "Some")
            health.budget = yield* budget.value
              .status(guild)
              .pipe(
                Effect.catch(() =>
                  Effect.succeed({ reason: "accounting-unavailable" as const }),
                ),
              );
          return health;
        }),
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
          const contextual =
            context._tag === "Some"
              ? yield* context.value.acquire(source)
              : source;
          const acquisition = reports.attachments?.();
          const selected = yield* attachmentInputs(
            contextual.attachments,
            acquisition,
          );
          const supplied = {
            ...contextual,
            ...(selected.inputs.length
              ? { attachmentInputs: selected.inputs }
              : {}),
          };
          const systemPrompt = `${judgmentInstructions}\n${config.prompt}`;
          stage = "judgment";
          const raw = yield* ai.generate(
            JSON.stringify(supplied),
            systemPrompt,
            { guildId: e.guildId, purpose: "judgment" },
            selected.contents,
          );
          const judgment = yield* Effect.try({
            try: () => parseJudgment(raw),
            catch: () => new ModerationUnavailable({ reason: "configuration" }),
          });
          yield* recover(e.guildId, "judgment");
          yield* recover(e.guildId, "budget");
          yield* recover(e.guildId, "accounting");
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
          // Publish only the content-free decision before translation. A newer none
          // stays transient while an older judgment can still make this source actionable.
          yield* store.serialize(
            e,
            store.assessed(
              e,
              judgment.action === "none" ? "harmless" : "actionable",
            ),
          );
          const retention = () =>
            store.serialize(
              e,
              Effect.gen(function* () {
                const prior = yield* store.read(e.guildId, e.messageId);
                const progress = yield* store.progress(e);
                if (
                  judgment.action !== "none" ||
                  prior.length ||
                  progress.some((p) => p.state === "actionable")
                )
                  return "retain" as const;
                if (
                  progress.some(
                    (p) =>
                      Date.parse(p.version) < Date.parse(e.version) &&
                      (p.state === "claimed" || p.state === "legacy"),
                  )
                )
                  return "pending" as const;
                yield* store.assessed(e);
                return "discard" as const;
              }),
            );
          let decision = yield* retention();
          while (decision === "pending") {
            yield* Effect.sleep("25 millis");
            decision = yield* retention();
          }
          const retain = decision === "retain";
          if (!retain) return "none" as const;
          stage = "translation";
          const auditTranslation = yield* translateAudit(record, ai).pipe(
            Effect.onInterrupt(() =>
              store
                .serialize(
                  e,
                  store.save(record).pipe(Effect.andThen(store.assessed(e))),
                )
                .pipe(
                  Effect.catch(() =>
                    reportFailure(e.guildId, channel, "database", true),
                  ),
                ),
            ),
          );
          record.auditTranslation = auditTranslation;
          if (auditTranslation.status === "unavailable")
            yield* reportFailure(e.guildId, channel, "translation");
          else if (auditTranslation.status === "available")
            yield* recover(e.guildId, "translation");
          stage = "database";
          return yield* store.serialize(
            e,
            Effect.gen(function* () {
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
                acquisition,
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
              recordFailure(e.guildId, stage, stage !== "translation");
            }),
          ),
          Effect.catch((error) =>
            reportFailure(
              e.guildId,
              channel,
              "operation" in error &&
                (error.operation === "budget" ||
                  error.operation === "accounting")
                ? error.operation
                : "reason" in error && error.reason === "database"
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
