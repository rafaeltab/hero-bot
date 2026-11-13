import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { Data, Effect } from "effect";

export class DevelopmentProcessUnavailable extends Data.TaggedError(
  "DevelopmentProcessUnavailable",
)<Record<never, never>> {}

export const withDevelopmentProcess = <A, E, R>(
  program: Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    Effect.try({
      try: () => {
        const directory = new URL("../../.env.processes/", import.meta.url);
        const file = new URL(`${process.pid}.json`, directory);
        const stamp = readFileSync(`/proc/${process.pid}/stat`, "utf8")
          .split(") ")[1]
          ?.split(" ")[19];
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        writeFileSync(file, JSON.stringify({ pid: process.pid, stamp }), {
          mode: 0o600,
        });
        return file;
      },
      catch: () => new DevelopmentProcessUnavailable(),
    }),
    () => program,
    (file) =>
      Effect.try({
        try: () => rmSync(file, { force: true }),
        catch: () => new DevelopmentProcessUnavailable(),
      }),
  );
