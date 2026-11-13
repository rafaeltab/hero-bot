import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
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
} from "../src/capabilities/moderation/ports.ts";
import {
  TextGeneration,
  TextGenerationUnavailable,
} from "../src/capabilities/text-generation/contract.ts";

import { configuration, evidence } from "./support/intake-fixture.ts";

const scenario = (
  run: (
    i: typeof Intake.Service,
    records: RecordEntry[],
    reports: RecordEntry[],
    inputs: string[],
    notices: string[],
  ) => Effect.Effect<void, unknown>,
  options: {
    raw?: string;
    actorRoles?: string[];
    fault?: string;
    configured?: boolean;
    private?: boolean;
    usable?: boolean;
    prompt?: string;
    problems?: string[];
    downloads?: string[];
    suppliedContents?: unknown[];
    attachmentBytes?: Uint8Array;
    downloadError?: string;
    noAcquisition?: boolean;
  } = {},
) => {
  const records: RecordEntry[] = [];
  const reports: RecordEntry[] = [];
  const inputs: string[] = [];
  const claims = new Set<string>();
  const notices: string[] = [];
  let inspections = 0;
  const fail = () =>
    Effect.fail(new ModerationUnavailable({ reason: "database" }));
  return Effect.gen(function* () {
    yield* run(yield* Intake, records, reports, inputs, notices);
  }).pipe(
    Effect.provide(IntakeLive),
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(ConfigurationStore, {
          history: () =>
            options.fault === "history"
              ? fail()
              : Effect.succeed(
                  options.configured === false
                    ? []
                    : [
                        {
                          ...configuration,
                          prompt: options.prompt ?? configuration.prompt,
                        },
                      ],
                ),
          save: () => Effect.die("unused"),
        }),
        Layer.succeed(GuildAccess, {
          inspect: () =>
            Effect.sync(() => ({
              ownerId: "11",
              actorRoles: options.actorRoles ?? [],
              roles: [],
              channels: [
                {
                  id: "30",
                  private:
                    options.private !== false &&
                    !(options.fault === "privacy" && inspections++ > 0),
                  usable: options.usable !== false,
                },
              ],
              problems: options.problems ?? [],
            })),
        }),
        Layer.succeed(IntakeStore, {
          serialize: (_e, task) => task,
          progress: () =>
            Effect.succeed(
              records.map((r) => ({
                version: r.evidence.version,
                state: "assessed",
              })),
            ),
          assessed: () => Effect.void,
          delivering: () => Effect.void,
          claim: (e) =>
            options.fault === "claim"
              ? fail()
              : Effect.sync(() => {
                  const key = e.guildId + e.messageId + e.version;
                  if (claims.has(key)) return false;
                  claims.add(key);
                  return true;
                }),
          save: (r) =>
            options.fault === "save"
              ? fail()
              : Effect.sync(() => {
                  records.push(r);
                }),
          delivered: () =>
            options.fault === "delivery-state" ? fail() : Effect.void,
          read: () =>
            Effect.succeed(
              records.map((record) => ({ record, delivery: null })),
            ),
        }),
        Layer.succeed(Reports, {
          ...(options.noAcquisition
            ? {}
            : {
                attachments: () => ({
                  acquire: async (url) => {
                    options.downloads?.push(url);
                    if (options.downloadError)
                      throw Error(options.downloadError);
                    return (
                      options.attachmentBytes ??
                      new TextEncoder().encode("%PDF-1.4\n%%EOF")
                    );
                  },
                }),
              }),
          refresh: (d) => Effect.succeed(d),
          publish: (r) =>
            options.fault === "publish"
              ? fail()
              : Effect.sync(() => {
                  reports.push(r);
                  return { rootId: "root", threadId: "thread" };
                }),
          notify: () =>
            Effect.sync(() => {
              notices.push("service failure");
            }).pipe(
              Effect.andThen(options.fault === "notify" ? fail() : Effect.void),
            ),
        }),
        Layer.succeed(TextGeneration, {
          generate: (p, _system, contents) =>
            options.fault === "ai"
              ? Effect.fail(
                  new TextGenerationUnavailable({ operation: "generate" }),
                )
              : Effect.sync(() => {
                  inputs.push(p);
                  options.suppliedContents?.push(...(contents ?? []));
                  return (
                    (p.includes("authorized")
                      ? '{"action":"none","reason":"Allowed.","offendingUrls":[]}'
                      : options.raw) ??
                    JSON.stringify({
                      action: "ban",
                      reason: "Platform presumption; piracy unverified.",
                      offendingUrls: ["https://bilibili.com/video/1"],
                    })
                  );
                }),
        }),
      ),
    ),
  );
};
it.effect(
  "actionable creation preserves exact evidence and provenance and reports once despite concurrent duplicate delivery",
  () =>
    scenario((i, records, reports, inputs) =>
      Effect.gen(function* () {
        expect(
          yield* Effect.all([i.receive(evidence), i.receive(evidence)], {
            concurrency: "unbounded",
          }),
        ).toEqual(["reported", "duplicate"]);
        expect(records).toMatchObject([
          {
            evidence,
            configuration,
            judgment: { action: "ban" },
            model: "gpt-6-luna",
          },
        ]);
        expect(reports).toEqual(records);
        expect(inputs).toHaveLength(1);
      }),
    ),
);
it.effect.each([
  { authorId: "11" },
  { channelId: "30" },
  { channelId: "31" },
  { parentId: "30" },
  { parentId: "31" },
])("exempt source is never judged, archived or reported: %j", (change) =>
  scenario((i, records, reports, inputs) =>
    Effect.gen(function* () {
      expect(yield* i.receive({ ...evidence, ...change })).toBe("exempt");
      expect([records, reports, inputs]).toEqual([[], [], []]);
    }),
  ),
);
it.effect(
  "actual designated moderator is exempt even if gateway roles are stale",
  () =>
    scenario(
      (i, records, reports, inputs) =>
        Effect.gen(function* () {
          expect(yield* i.receive(evidence)).toBe("exempt");
          expect([records, reports, inputs]).toEqual([[], [], []]);
        }),
      { actorRoles: ["mod"] },
    ),
);
it.effect(
  "course role and mapped admin alone confer no exemption; none leaves no message or judgment archive",
  () =>
    scenario(
      (i, records, reports, inputs) =>
        Effect.gen(function* () {
          expect(yield* i.receive(evidence)).toBe("none");
          expect(records).toEqual([]);
          expect(reports).toEqual([]);
          expect(inputs).toEqual([
            JSON.stringify({ ...evidence, currentRoles: ["course", "admin"] }),
          ]);
          expect(yield* i.receive(evidence)).toBe("duplicate");
        }),
      {
        raw: '{"action":"none","reason":"Authorized discussion.","offendingUrls":[]}',
        actorRoles: ["course", "admin"],
      },
    ),
);
it.effect.each(["delete", "review-hold"])(
  "accepts compact %s recommendation without an offending URL",
  (action) =>
    scenario(
      (i, records) =>
        Effect.gen(function* () {
          expect(yield* i.receive(evidence)).toBe("reported");
          expect(records[0]?.judgment).toEqual({
            action,
            reason: "Intent uncertain. Review supplied evidence.",
            offendingUrls: [],
          });
        }),
      {
        raw: JSON.stringify({
          action,
          reason: "Intent uncertain. Review supplied evidence.",
          offendingUrls: [],
        }),
      },
    ),
);
it.effect.each([
  "not json",
  '{"action":"ban","reason":"第一句。第二句。第三句。","offendingUrls":[]}',
  "null",
  "{}",
  '{"action":"kick","reason":"No.","offendingUrls":[]}',
  '{"action":"ban","reason":"One. Two. Three.","offendingUrls":[]}',
  '{"action":"ban","reason":"","offendingUrls":[]}',
  '{"action":"ban","reason":"No.","offendingUrls":[42]}',
  '{"action":"ban","reason":"No.","offendingUrls":["javascript:bad"]}',
  '{"action":"ban","reason":"No.","offendingUrls":[],"confidence":1}',
])(
  "invalid AI output is a service failure, never a none or a member finding: %s",
  (raw) =>
    scenario(
      (i, records, reports, _inputs, notices) =>
        Effect.gen(function* () {
          expect(yield* i.receive(evidence)).toBe("failed");
          expect([records, reports]).toEqual([[], []]);
          expect(notices).toEqual(["service failure"]);
        }),
      { raw },
    ),
);
it.effect.each(["ai", "claim", "save", "history"])(
  "unavailable %s keeps source alone and makes no member report",
  (fault) =>
    scenario(
      (i, records, reports, _inputs, notices) =>
        Effect.gen(function* () {
          expect(yield* i.receive(evidence)).toBe("failed");
          expect([records, reports]).toEqual([[], []]);
          expect(notices).toEqual(["service failure"]);
        }),
      { fault },
    ),
);
it.effect.each(["publish", "privacy"])(
  "private delivery %s failure retains evidence without successful delivery claim",
  (fault) =>
    scenario(
      (i, records, reports, _inputs, notices) =>
        Effect.gen(function* () {
          expect(yield* i.receive(evidence)).toBe("failed");
          expect(records).toHaveLength(1);
          expect(reports).toEqual([]);
          expect(notices).toEqual(["service failure"]);
          expect(["duplicate", "failed"]).toContain(yield* i.receive(evidence));
        }),
      { fault },
    ),
);
it.effect(
  "delivery-state write failure reports failure rather than inventing recorded delivery",
  () =>
    scenario(
      (i, records, reports) =>
        Effect.gen(function* () {
          expect(yield* i.receive(evidence)).toBe("failed");
          expect(records).toHaveLength(1);
          expect(reports).toHaveLength(1);
        }),
      { fault: "delivery-state" },
    ),
);
it.effect.each([
  { configured: false },
  { private: false },
  { usable: false },
  { prompt: "" },
  { problems: ["missing permission"] },
])("unready server blocks judgment: %j", (options) =>
  scenario(
    (i, records, reports, inputs) =>
      Effect.gen(function* () {
        expect(yield* i.receive(evidence)).toBe("failed");
        expect([records, reports, inputs]).toEqual([[], [], []]);
      }),
    options,
  ),
);
it.effect(
  "failed service notification uses sanitized logging without retaining ordinary contents",
  () =>
    scenario(
      (i, records, reports) =>
        Effect.gen(function* () {
          expect(yield* i.receive(evidence)).toBe("failed");
          expect([records, reports]).toEqual([[], []]);
        }),
      { raw: "bad", fault: "notify" },
    ),
);

it.effect(
  "actionable to harmless edits retain both versions and use the same report identity",
  () =>
    scenario((i, records, reports) =>
      Effect.gen(function* () {
        expect(yield* i.receive(evidence)).toBe("reported");
        expect(
          yield* i.receive({
            ...evidence,
            version: "2026-11-13T00:01:00Z",
            text: "authorized",
          }),
        ).toBe("reported");
        expect(records.map((r) => r.evidence.version)).toEqual([
          "2026-11-13T00:00:00Z",
          "2026-11-13T00:01:00Z",
        ]);
        expect(records[1]?.judgment.action).toBe("none");
        expect(reports).toHaveLength(2);
      }),
    ),
);

it.effect(
  "supplies PDF original contents once and retains truthful metadata without blobs",
  () => {
    const downloads: string[] = [];
    const contents: unknown[] = [];
    const attachment = {
      id: "a",
      filename: "lesson.pdf",
      content_type: "application/pdf",
      size: 14,
      url: "https://cdn.discordapp.com/attachments/1/lesson.pdf",
    };
    return scenario(
      (i, records, reports, inputs) =>
        Effect.gen(function* () {
          expect(
            yield* i.receive({ ...evidence, attachments: [attachment] }),
          ).toBe("reported");
          expect(downloads).toEqual([attachment.url]);
          expect(contents).toEqual([
            {
              filename: "lesson.pdf",
              mediaType: "application/pdf",
              data: new TextEncoder().encode("%PDF-1.4\n%%EOF"),
            },
          ]);
          expect(records[0]?.evidence.attachmentInputs).toEqual([
            {
              index: 0,
              attachmentId: "a",
              filename: "lesson.pdf",
              status: "supplied",
              mediaType: "application/pdf",
              bytes: 14,
            },
          ]);
          expect(inputs[0]).toContain('"status":"supplied"');
          expect(JSON.stringify(records)).not.toContain("%%EOF");
          expect(reports).toEqual(records);
        }),
      { downloads, suppliedContents: contents },
    );
  },
);

it.effect.each([
  { metadata: null, reason: "malformed-metadata" },
  { metadata: { filename: "x" }, reason: "malformed-metadata" },
  {
    metadata: { filename: "x", url: "url", size: 14 },
    reason: "unsupported-format",
  },
  {
    metadata: {
      filename: "x",
      url: "url",
      size: 14,
      content_type: "video/mp4",
    },
    reason: "unsupported-format",
  },
  {
    metadata: {
      filename: "x",
      url: "url",
      size: 14,
      content_type: "application/pdf",
    },
    reason: "acquisition-unavailable",
    noAcquisition: true,
  },
  {
    metadata: {
      filename: "x",
      url: "url",
      size: 14,
      content_type: "application/pdf",
    },
    reason: "download-budget",
    downloadError: "download-budget",
  },
  {
    metadata: {
      filename: "x",
      url: "url",
      size: 14,
      content_type: "application/pdf",
    },
    reason: "download-unavailable",
    downloadError: "secret details",
  },
  {
    metadata: {
      filename: "x",
      url: "url",
      size: 50,
      content_type: "application/pdf",
    },
    reason: "size-mismatch-or-truncated",
  },
  {
    metadata: {
      filename: "x",
      url: "url",
      size: 3,
      content_type: "application/pdf",
    },
    reason: "unreadable-or-format-mismatch",
    attachmentBytes: new Uint8Array([1, 2, 3]),
  },
])("judgment reports unavailable attachment accurately: $reason", (c) =>
  scenario(
    (i, records) =>
      Effect.gen(function* () {
        expect(
          yield* i.receive({ ...evidence, attachments: [c.metadata] }),
        ).toBe("reported");
        expect(records[0]?.evidence.attachmentInputs).toMatchObject([
          { index: 0, status: "unavailable", reason: c.reason },
        ]);
        expect(JSON.stringify(records)).not.toContain("secret details");
      }),
    c,
  ),
);

it.effect(
  "omits the fifth AI content explicitly without omitting source metadata",
  () => {
    const contents: unknown[] = [];
    return scenario(
      (i, records) =>
        Effect.gen(function* () {
          const attachments = Array.from({ length: 5 }, (_, n) => ({
            id: String(n),
            filename: "x.pdf",
            content_type: "application/pdf",
            size: 14,
            url: String(n),
          }));
          expect(yield* i.receive({ ...evidence, attachments })).toBe(
            "reported",
          );
          expect(contents).toHaveLength(4);
          expect(records[0]?.evidence.attachments).toEqual(attachments);
          expect(records[0]?.evidence.attachmentInputs?.[4]).toEqual({
            index: 4,
            attachmentId: "4",
            filename: "x.pdf",
            status: "unavailable",
            reason: "content-limit",
          });
        }),
      { suppliedContents: contents },
    );
  },
);
