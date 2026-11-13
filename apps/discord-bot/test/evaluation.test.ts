import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it("controlled policy evaluation produces comparable provenance and expected/actual results without paid calls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hero-eval-"));
  const path = join(dir, "results.json");
  try {
    await promisify(execFile)(
      process.execPath,
      ["tooling/evaluate-policy.mjs", "--output", path],
      { cwd: new URL("..", import.meta.url), env: { PATH: process.env.PATH } },
    );
    const result = JSON.parse(await readFile(path, "utf8"));
    expect(result).toMatchObject({
      formatVersion: 1,
      mode: "controlled-plumbing-only",
      caseVersion: 1,
      model: "gpt-6-luna",
      promptHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      caseHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      commit: expect.stringMatching(/^[a-f0-9]{40}$/),
    });
    expect(result.results).toHaveLength(17);
    expect(result.results[0]).toMatchObject({
      id: "bare-bilibili",
      expected: { action: "ban" },
      actual: {
        action: "ban",
        offendingUrls: ["https://bilibili.com/video/1"],
      },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
