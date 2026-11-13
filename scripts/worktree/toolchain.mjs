import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const { engines } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);
for (const [tool, expected] of Object.entries(engines)) {
  const actual = execFileSync(tool, ["--version"], { encoding: "utf8" })
    .trim()
    .replace(/^v/, "");
  if (actual !== expected)
    throw Error(
      `Expected ${tool} ${expected}; installed ${actual}. Select the pinned toolchain before make install.`,
    );
}
