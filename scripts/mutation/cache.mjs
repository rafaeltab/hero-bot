import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { resolve } from "node:path";

export function projectFingerprint(root) {
  const hash = createHash("sha256");
  const inputs = new Set(
    execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: root, encoding: "utf8" },
    )
      .split("\0")
      .filter(Boolean),
  );
  for (const name of [...inputs].sort()) {
    hash.update(name).update("\0");
    try {
      const input = resolve(root, name);
      hash.update(
        lstatSync(input).isSymbolicLink()
          ? readlinkSync(input)
          : readFileSync(input),
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      hash.update("<deleted>");
    }
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function cacheKey(plan, fingerprint) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        plan,
        fingerprint,
        node: process.version,
        stryker: "10.1.1",
      }),
    )
    .digest("hex")
    .slice(0, 16);
}
