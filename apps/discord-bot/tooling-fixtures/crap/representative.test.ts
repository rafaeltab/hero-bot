import { Effect } from "effect";
import { expect, it } from "vitest";
import {
  boundary30,
  boundary31,
  deferred,
  program,
  typed,
} from "./representative.ts";

it("executes typed functions and deferred Effect callbacks", async () => {
  expect(typed(1)).toBe(1);
  expect(await Effect.runPromise(program(-1))).toBe(20);
});

it("executes both sides of the complexity boundary fixtures", () => {
  expect([boundary30(0), boundary30(1), boundary31(0), boundary31(1)]).toEqual([
    0, 1, 0, 1,
  ]);
});

it("constructs a deferred Effect without running its callback", () => {
  expect(Effect.isEffect(deferred(1))).toBe(true);
});
