import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Config, Effect, Layer } from "effect";
import { Pool } from "pg";
import {
  AiBudget,
  type BudgetPolicy,
  type BudgetTotals,
} from "../capabilities/ai-budget/contract.ts";
import { TextGenerationUnavailable } from "../capabilities/text-generation/contract.ts";
import {
  reservationCost,
  tokenCost,
  validateBudgetPolicy,
} from "./budget-config.ts";

type Entry = {
  id: string;
  guild: string;
  day: string;
  policy: BudgetPolicy;
  held: number;
  reported: number;
  known: boolean;
};
const totals = (entries: Entry[]): BudgetTotals => {
  return {
    reportedMicroUsd: entries.reduce((n, e) => n + e.reported, 0),
    heldMicroUsd: entries.reduce((n, e) => n + e.held, 0),
    unknownAttempts: entries.filter((e) => !e.known).length,
  };
};
const reason = (
  policy: BudgetPolicy,
  guild: string,
  own: BudgetTotals,
  shared: BudgetTotals,
) => {
  const limit = policy.guildMicroUsd[guild];
  if (limit === undefined) return "unconfigured" as const;
  if (
    shared.reportedMicroUsd + shared.heldMicroUsd + reservationCost(policy) >
    policy.sharedMicroUsd
  )
    return "shared" as const;
  if (own.reportedMicroUsd + own.heldMicroUsd + reservationCost(policy) > limit)
    return "guild" as const;
  return "available" as const;
};
export const budgetPostgresLayer = (
  policy: BudgetPolicy,
  table = "ai_budget_attempts",
  now = () => new Date(),
) =>
  Layer.effect(
    AiBudget,
    Effect.gen(function* () {
      yield* Effect.try({
        try: () => {
          validateBudgetPolicy(policy);
          if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw Error();
        },
        catch: () =>
          new TextGenerationUnavailable({ operation: "configuration" }),
      });
      const url = yield* Config.String("DATABASE_URL").pipe(
        Effect.mapError(
          () => new TextGenerationUnavailable({ operation: "configuration" }),
        ),
      );
      const pool = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const p = new Pool({ connectionString: url, max: 4 });
          p.on("error", () => undefined);
          return p;
        }),
        (p) => Effect.promise(() => p.end()),
      );
      const db = drizzle(pool);
      const t = sql.identifier(table);
      const query = <A>(run: () => Promise<A>) =>
        Effect.tryPromise({
          try: run,
          catch: () =>
            new TextGenerationUnavailable({ operation: "accounting" }),
        });
      yield* query(async () => {
        await db.transaction(async (tx) => {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${table},0))`,
          );
          await tx.execute(
            sql`create table if not exists ${t} (id text primary key,guild text not null,day text not null,purpose text not null,attempt integer not null,policy jsonb not null,held bigint not null,reported bigint not null default 0,known boolean not null default false,outcome text not null default 'pending',input_tokens bigint,output_tokens bigint,admitted_at timestamptz not null default now())`,
          );
        });
      });
      const currentDay = () => now().toISOString().slice(0, 10);
      const read = async (day: string) => {
        const r = await db.execute<Entry>(
          sql`select id,guild,day,policy,held::float8,reported::float8,known from ${t} where day=${day}`,
        );
        return r.rows;
      };
      return AiBudget.of({
        status: (guild) =>
          query(async () => {
            const day = currentDay();
            const rows = await read(day);
            const own = totals(rows.filter((e) => e.guild === guild));
            const shared = totals(rows);
            return {
              day,
              timezone: "UTC" as const,
              reason: reason(policy, guild, own, shared),
              guild: own,
              shared,
              policy: {
                ...policy,
                guildMicroUsd:
                  policy.guildMicroUsd[guild] === undefined
                    ? {}
                    : { [guild]: policy.guildMicroUsd[guild] },
              },
            };
          }),
        reserve: (event) =>
          Effect.gen(function* () {
            if (!event.id || !event.guildId || !event.purpose)
              return yield* Effect.fail(
                new TextGenerationUnavailable({ operation: "budget" }),
              );
            const guildId = event.guildId;
            const admitted = yield* query(() =>
              db.transaction(async (tx) => {
                await tx.execute(
                  sql`select pg_advisory_xact_lock(hashtextextended(${table},0))`,
                );
                const day = currentDay();
                const rows = (
                  await tx.execute<Entry>(
                    sql`select id,guild,day,policy,held::float8,reported::float8,known from ${t} where day=${day}`,
                  )
                ).rows;
                if (
                  reason(
                    policy,
                    guildId,
                    totals(rows.filter((e) => e.guild === event.guildId)),
                    totals(rows),
                  ) !== "available"
                )
                  return false;
                await tx.execute(
                  sql`insert into ${t} (id,guild,day,purpose,attempt,policy,held) values (${event.id},${event.guildId},${day},${event.purpose},${event.attempt},${JSON.stringify(policy)}::jsonb,${reservationCost(policy)})`,
                );
                return true;
              }),
            );
            if (!admitted)
              return yield* Effect.fail(
                new TextGenerationUnavailable({ operation: "budget" }),
              );
          }),
        settle: (event) =>
          query(async () => {
            await db.transaction(async (tx) => {
              const r = await tx.execute<Entry>(
                sql`select policy,known from ${t} where id=${event.id} for update`,
              );
              const entry = r.rows[0];
              if (!entry) throw Error();
              if (entry.known) return;
              const input = event.inputTokens;
              const output = event.outputTokens;
              const known =
                Number.isSafeInteger(input) &&
                Number(input) >= 0 &&
                Number.isSafeInteger(output) &&
                Number(output) >= 0;
              if (!known) {
                await tx.execute(
                  sql`update ${t} set outcome=${event.outcome} where id=${event.id}`,
                );
                return;
              }
              const cost = tokenCost(
                entry.policy,
                Number(input),
                Number(output),
              );
              if (!Number.isSafeInteger(cost)) throw Error();
              await tx.execute(
                sql`update ${t} set held=0,reported=${cost},known=true,outcome=${event.outcome},input_tokens=${input},output_tokens=${output} where id=${event.id}`,
              );
            });
          }),
      });
    }),
  );
