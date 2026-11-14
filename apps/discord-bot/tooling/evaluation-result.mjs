import { Effect } from "effect";
import { parseJudgment } from "../dist/capabilities/moderation/judgment.js";

/** Keep paid and controlled runners' failure reports equivalent and sanitized. */
export const evaluationResult = (request) =>
  request.pipe(
    Effect.map((raw) => {
      try {
        return { actual: parseJudgment(raw) };
      } catch {
        return { failure: "invalid-output" };
      }
    }),
    Effect.catch((error) =>
      Effect.succeed({
        failure:
          error.operation === "budget"
            ? "budget-exhausted"
            : error.operation === "accounting"
              ? "accounting-unavailable"
              : "provider-unavailable",
      }),
    ),
  );
