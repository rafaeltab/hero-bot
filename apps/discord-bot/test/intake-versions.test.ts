import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { intakePostgresLayer } from "../src/adapters/intake-postgres.ts";
import {
  Intake,
  ModerationUnavailable,
  type RecordEntry,
} from "../src/capabilities/moderation/contract.ts";
import { IntakeLive } from "../src/capabilities/moderation/intake.ts";
import {
  ConfigurationStore,
  GuildAccess,
  IntakeStore,
  Reports,
  type ReportUpdate,
} from "../src/capabilities/moderation/ports.ts";
import { TextGeneration } from "../src/capabilities/text-generation/contract.ts";
import {
  configurationDatabase,
  databaseConfig,
} from "./support/configuration-database.ts";
import { configuration, evidence } from "./support/intake-fixture.ts";

const edit = { ...evidence, version: "2026-11-13T00:01:00Z", text: "allowed" };
const judgment = (input: string) =>
  JSON.stringify({
    action: JSON.parse(input).text === "allowed" ? "none" : "ban",
    reason: "Controlled policy result.",
    offendingUrls: [],
  });
const fixture = () => {
  const reports: { record: RecordEntry; update: ReportUpdate | undefined }[] =
    [];
  let calls = 0;
  let roots = 0;
  let loseAck = false;
  let inspectGate = () => Effect.void;
  let publishGate = () => Effect.void;
  let generate = (input: string) => Effect.succeed(judgment(input));
  const boundaries = Layer.mergeAll(
    Layer.succeed(ConfigurationStore, {
      history: () => Effect.succeed([configuration]),
      save: () => Effect.die("unused"),
    }),
    Layer.succeed(GuildAccess, {
      inspect: () =>
        inspectGate().pipe(
          Effect.andThen(
            Effect.succeed({
              ownerId: "11",
              actorRoles: [],
              roles: [],
              channels: [{ id: "30", private: true, usable: true }],
              problems: [],
            }),
          ),
        ),
    }),
    Layer.succeed(TextGeneration, {
      generate: (input) => {
        calls++;
        return generate(input);
      },
    }),
    Layer.succeed(Reports, {
      refresh: (d) => Effect.succeed(d),
      publish: (record, _checkpoint, _acquisition, update) =>
        Effect.gen(function* () {
          if (!update?.delivery) roots++;
          reports.push({ record, update });
          yield* publishGate();
          if (loseAck)
            return yield* Effect.fail(
              new ModerationUnavailable({ reason: "discord" }),
            );
          return {
            ...(update?.delivery ?? { rootId: "root", threadId: "thread" }),
            state: "complete" as const,
          };
        }),
      notify: () => Effect.void,
    }),
  );
  return {
    reports,
    boundaries,
    inspectGate: (fn: typeof inspectGate) => {
      inspectGate = fn;
    },
    publishGate: (fn: typeof publishGate) => {
      publishGate = fn;
    },
    calls: () => calls,
    roots: () => roots,
    loseAck: () => {
      loseAck = true;
    },
    generate: (fn: typeof generate) => {
      generate = fn;
    },
  };
};
const scenario = (
  run: (
    f: ReturnType<typeof fixture>,
    reopen: <A, E>(
      task: Effect.Effect<A, E, Intake | IntakeStore>,
    ) => Effect.Effect<A, E | ModerationUnavailable>,
  ) => Effect.Effect<void, unknown>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const table = yield* configurationDatabase;
      const f = fixture();
      const reopen = <A, E>(task: Effect.Effect<A, E, Intake | IntakeStore>) =>
        task.pipe(
          Effect.provide(
            Layer.provideMerge(
              IntakeLive,
              Layer.mergeAll(intakePostgresLayer(table), f.boundaries),
            ),
          ),
          Effect.provide(databaseConfig),
        );
      yield* run(f, reopen);
    }),
  );

it.effect(
  "durable edit history: harmless to actionable to harmless, duplicate edits and restart share one root",
  () =>
    scenario((f, reopen) =>
      Effect.gen(function* () {
        yield* reopen(
          Effect.gen(function* () {
            const i = yield* Intake;
            expect(yield* i.receive({ ...evidence, text: "allowed" })).toBe(
              "none",
            );
            expect(yield* (yield* IntakeStore).read("10", "100")).toEqual([]);
            expect(yield* i.receive({ ...edit, text: evidence.text })).toBe(
              "reported",
            );
          }),
        );
        yield* reopen(
          Effect.gen(function* () {
            const i = yield* Intake;
            const later = { ...edit, version: "2026-11-13T00:02:00Z" };
            expect(yield* i.receive(later)).toBe("reported");
            expect(yield* i.receive(later)).toBe("duplicate");
            const s = yield* IntakeStore;
            expect(
              (yield* s.read("10", "100")).map((r) => r.record.judgment.action),
            ).toEqual(["ban", "none"]);
            expect(yield* s.progress(evidence)).toEqual([
              { version: evidence.version, state: "assessed" },
              { version: edit.version, state: "delivered" },
              { version: later.version, state: "delivered" },
            ]);
          }),
        );
        expect(f.calls()).toBe(3);
        expect(f.roots()).toBe(1);
        expect(f.reports[1]?.update?.delivery).toEqual({
          rootId: "root",
          threadId: "thread",
          state: "complete",
        });
      }),
    ),
);

it.effect(
  "out-of-order AI completion keeps the newer judgment at the root and preserves the older finding",
  () =>
    scenario((f, reopen) =>
      Effect.gen(function* () {
        let release!: (s: string) => void;
        let started!: () => void;
        const waiting = new Promise<void>((r) => {
          started = r;
        });
        f.generate((input) =>
          JSON.parse(input).version === evidence.version
            ? Effect.promise(() => {
                started();
                return new Promise<string>((r) => {
                  release = r;
                });
              })
            : Effect.succeed(judgment(input)),
        );
        const older = Effect.runPromise(
          reopen(
            Effect.gen(function* () {
              return yield* (yield* Intake).receive(evidence);
            }),
          ),
        );
        yield* Effect.promise(() => waiting);
        yield* reopen(
          Effect.gen(function* () {
            expect(
              yield* (yield* Intake).receive({ ...edit, text: evidence.text }),
            ).toBe("reported");
          }),
        );
        release(judgment(JSON.stringify(evidence)));
        expect(yield* Effect.promise(() => older)).toBe("reported");
        expect(f.reports[1]?.record.evidence.version).toBe(evidence.version);
        expect(f.reports[1]?.update?.latest.evidence.version).toBe(
          edit.version,
        );
        expect(f.roots()).toBe(1);
      }),
    ),
);

it.effect(
  "acknowledgment loss blocks blind root recreation after restart but retains later judgments",
  () =>
    scenario((f, reopen) =>
      Effect.gen(function* () {
        f.loseAck();
        yield* reopen(
          Effect.gen(function* () {
            expect(yield* (yield* Intake).receive(evidence)).toBe("failed");
          }),
        );
        yield* reopen(
          Effect.gen(function* () {
            const i = yield* Intake;
            expect(yield* i.receive(evidence)).toBe("duplicate");
            expect(yield* i.receive(edit)).toBe("failed");
            const s = yield* IntakeStore;
            expect(
              (yield* s.read("10", "100")).map((r) => r.record.judgment.action),
            ).toEqual(["ban", "none"]);
            expect(yield* s.progress(evidence)).toEqual([
              { version: evidence.version, state: "delivering" },
              { version: edit.version, state: "assessed" },
            ]);
          }),
        );
        expect(f.calls()).toBe(2);
        expect(f.roots()).toBe(1);
      }),
    ),
);

it.effect(
  "interruption after durable claim never replays the uncertain AI call on restart",
  () =>
    scenario((f, reopen) =>
      Effect.gen(function* () {
        let started!: () => void;
        const waiting = new Promise<void>((r) => {
          started = r;
        });
        f.generate(() =>
          Effect.sync(() => started()).pipe(Effect.andThen(Effect.never)),
        );
        const controller = new AbortController();
        const running = Effect.runPromiseExit(
          reopen(
            Effect.gen(function* () {
              return yield* (yield* Intake).receive(evidence);
            }),
          ),
          { signal: controller.signal },
        );
        yield* Effect.promise(() => waiting);
        controller.abort();
        yield* Effect.promise(() => running);
        yield* reopen(
          Effect.gen(function* () {
            expect(yield* (yield* Intake).receive(evidence)).toBe("duplicate");
            expect(yield* (yield* IntakeStore).progress(evidence)).toEqual([
              { version: evidence.version, state: "claimed" },
            ]);
          }),
        );
        expect(f.calls()).toBe(1);
        expect(f.roots()).toBe(0);
      }),
    ),
);

it.effect(
  "concurrent versions and duplicate edits across independent stores cannot create a second root",
  () =>
    scenario((f, reopen) =>
      Effect.gen(function* () {
        const send = (e: typeof evidence) =>
          reopen(
            Effect.gen(function* () {
              return yield* (yield* Intake).receive(e);
            }),
          );
        const results = yield* Effect.all(
          [
            send(evidence),
            send({ ...edit, text: evidence.text }),
            send({ ...edit, text: evidence.text }),
          ],
          { concurrency: "unbounded" },
        );
        expect(results.filter((r) => r === "duplicate")).toHaveLength(1);
        expect(results.filter((r) => r === "reported")).toHaveLength(2);
        expect(f.calls()).toBe(2);
        expect(f.roots()).toBe(1);
      }),
    ),
);

it.effect.each([
  {
    stage: "preserved before reservation",
    result: "reported",
    state: "assessed",
    initialRoots: 0,
  },
  {
    stage: "external delivery reserved",
    result: "failed",
    state: "delivering",
    initialRoots: 1,
  },
])(
  "interruption at $stage retains evidence and makes restart uncertainty explicit",
  ({ stage, result, state, initialRoots }) =>
    scenario((f, reopen) =>
      Effect.gen(function* () {
        let started!: () => void;
        const waiting = new Promise<void>((resolve) => {
          started = resolve;
        });
        const gate = () =>
          Effect.sync(() => started()).pipe(Effect.andThen(Effect.never));
        let inspections = 0;
        if (stage === "preserved before reservation")
          f.inspectGate(() => (++inspections === 2 ? gate() : Effect.void));
        else f.publishGate(gate);
        const controller = new AbortController();
        const running = Effect.runPromiseExit(
          reopen(
            Effect.gen(function* () {
              return yield* (yield* Intake).receive(evidence);
            }),
          ),
          { signal: controller.signal },
        );
        yield* Effect.promise(() => waiting);
        controller.abort();
        yield* Effect.promise(() => running);
        expect(f.roots()).toBe(initialRoots);
        f.inspectGate(() => Effect.void);
        f.publishGate(() => Effect.void);
        yield* reopen(
          Effect.gen(function* () {
            const s = yield* IntakeStore;
            expect(yield* s.progress(evidence)).toEqual([
              { version: evidence.version, state },
            ]);
            expect(yield* (yield* Intake).receive(evidence)).toBe("duplicate");
            expect(yield* (yield* Intake).receive(edit)).toBe(result);
            expect(
              (yield* s.read("10", "100")).map((r) => r.record.judgment.action),
            ).toEqual(["ban", "none"]);
          }),
        );
        expect(f.roots()).toBe(1);
        expect(f.calls()).toBe(2);
      }),
    ),
);

it.live.each(["ban", "none"] as const)(
  "newer harmless judgment waits for an older unresolved %s source and survives restart",
  (action) =>
    scenario((f, reopen) =>
      Effect.gen(function* () {
        let release!: (s: string) => void;
        let started!: () => void;
        let newerJudged!: () => void;
        const waiting = new Promise<void>((r) => {
          started = r;
        });
        const newer = new Promise<void>((r) => {
          newerJudged = r;
        });
        f.generate((input) =>
          JSON.parse(input).version === evidence.version
            ? Effect.promise(() => {
                started();
                return new Promise<string>((r) => {
                  release = r;
                });
              })
            : Effect.sync(() => {
                newerJudged();
                return judgment(input);
              }),
        );
        const send = (e: typeof evidence) =>
          reopen(
            Effect.gen(function* () {
              return yield* (yield* Intake).receive(e);
            }),
          );
        const older = Effect.runPromise(send(evidence));
        yield* Effect.promise(() => waiting);
        const harmless = Effect.runPromise(send(edit));
        yield* Effect.promise(() => newer);
        // Observe the durable decision, not elapsed wall time, before releasing V1.
        yield* reopen(
          Effect.gen(function* () {
            const store = yield* IntakeStore;
            while (
              !(yield* store.progress(evidence)).some(
                (p) => p.version === edit.version && p.state === "harmless",
              )
            ) {
              yield* Effect.yieldNow;
            }
            expect(yield* store.read("10", "100")).toEqual([]);
          }),
        );
        release(
          JSON.stringify({
            action,
            reason: "Controlled policy result.",
            offendingUrls: [],
          }),
        );
        expect(yield* Effect.promise(() => older)).toBe(
          action === "ban" ? "reported" : "none",
        );
        expect(yield* Effect.promise(() => harmless)).toBe(
          action === "ban" ? "reported" : "none",
        );
        yield* reopen(
          Effect.gen(function* () {
            const history = yield* (yield* IntakeStore).read("10", "100");
            expect(
              history.map((h) => [
                h.record.evidence.version,
                h.record.judgment.action,
              ]),
            ).toEqual(
              action === "ban"
                ? [
                    [evidence.version, "ban"],
                    [edit.version, "none"],
                  ]
                : [],
            );
            expect(yield* (yield* Intake).receive(edit)).toBe("duplicate");
          }),
        );
        expect(f.reports.at(-1)?.update?.latest.judgment.action).toBe(
          action === "ban" ? "none" : undefined,
        );
        expect(f.roots()).toBe(action === "ban" ? 1 : 0);
      }),
    ),
);

it.live(
  "newer none is retained while older actionable translation is suspended",
  () =>
    scenario((f, reopen) =>
      Effect.gen(function* () {
        let release!: (s: string) => void;
        let started!: () => void;
        const waiting = new Promise<void>((r) => {
          started = r;
        });
        const original = {
          ...evidence,
          text: "Estoy vendiendo copias completas del curso sin permiso del autor.",
        };
        f.generate((input) =>
          Array.isArray(JSON.parse(input))
            ? Effect.promise(() => {
                started();
                return new Promise<string>((r) => {
                  release = r;
                });
              })
            : Effect.succeed(judgment(input)),
        );
        const send = (e: typeof evidence) =>
          reopen(
            Effect.gen(function* () {
              return yield* (yield* Intake).receive(e);
            }),
          );
        const older = Effect.runPromise(send(original));
        yield* Effect.promise(() => waiting);
        expect(yield* send(edit)).toBe("reported");
        release("invalid translation");
        expect(yield* Effect.promise(() => older)).toBe("reported");
        yield* reopen(
          Effect.gen(function* () {
            expect(
              (yield* (yield* IntakeStore).read("10", "100")).map((h) => [
                h.record.evidence.text,
                h.record.judgment.action,
              ]),
            ).toEqual([
              [original.text, "ban"],
              ["allowed", "none"],
            ]);
          }),
        );
        expect(f.reports.at(-1)?.update?.latest.evidence.version).toBe(
          edit.version,
        );
        expect(f.roots()).toBe(1);
      }),
    ),
);
