import { Effect } from "effect";

export type Contract = { readonly value: number };
export function typed(value: number): number {
  if (value > 0) return 1;
  return -1;
}
export const program = (value: number) =>
  Effect.gen(function* () {
    const nested = (input: number) => {
      if (input > 0) return 10;
      return 20;
    };
    yield* Effect.void;
    if (value > 0) return nested(value);
    return nested(value);
  });

export function uncalled(value: number) {
  if (value === 1) return 1;
  if (value === 2) return 2;
  if (value === 3) return 3;
  if (value === 4) return 4;
  if (value === 5) return 5;
  return 0;
}

export function boundary30(value: number) {
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  return value;
}

export function boundary31(value: number) {
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  if (value > 0) value += 0;
  return value;
}

export const deferred = (value: number) =>
  Effect.gen(function* () {
    yield* Effect.void;
    if (value === 1) return 1;
    if (value === 2) return 2;
    if (value === 3) return 3;
    if (value === 4) return 4;
    if (value === 5) return 5;
    return 0;
  });
