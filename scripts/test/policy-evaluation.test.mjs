import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { before, test } from "node:test";

before(() => {
  execFileSync("pnpm", ["--filter", "@hero-bot/discord-bot", "build"], {
    stdio: "pipe",
  });
});

const runner = resolve("apps/discord-bot/tooling/evaluate-policy.mjs");
const run = (...args) =>
  execFileSync(process.execPath, [runner, ...args], {
    encoding: "utf8",
    stdio: "pipe",
  });

test("operator gets immutable controlled evidence with comparable provenance, not model-quality claims", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hero-evaluation-"));
  try {
    const output = join(dir, "report.json");
    run("--output", output);
    const report = JSON.parse(await readFile(output, "utf8"));
    assert.equal(report.formatVersion, 2);
    assert.equal(report.mode, "controlled-plumbing-only");
    assert.equal(report.quality, "unverified");
    assert.match(report.integrity, /^[a-f0-9]{64}$/u);
    assert.ok(
      report.results.some(
        (r) => r.id === "screenshot" && r.attachments[0].sha256,
      ),
    );
    assert.ok(
      report.results.some(
        (r) =>
          r.id === "spanish-original" && r.translation.status === "available",
      ),
    );
    assert.ok(
      report.results.every((r) => r.caseHash && r.version && r.acceptance),
    );
    assert.throws(() => run("--output", output));
    const compared = join(dir, "comparison.json");
    run("--compare", output, output, "--output", compared);
    const comparison = JSON.parse(await readFile(compared, "utf8"));
    assert.deepEqual(comparison.differences, []);
    assert.deepEqual(
      comparison.results.filter((r) => r.changed),
      [],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("operator can compare invalid-output faults without turning them into harmless findings", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hero-evaluation-"));
  try {
    const baseline = join(dir, "baseline.json");
    const fault = join(dir, "fault.json");
    run("--case", "bare-bilibili", "--output", baseline);
    run("--controlled-invalid", "--case", "bare-bilibili", "--output", fault);
    const report = JSON.parse(await readFile(fault, "utf8"));
    assert.equal(report.results[0].failure, "invalid-output");
    assert.equal(report.results[0].actual, undefined);
    const output = join(dir, "comparison.json");
    run("--compare", baseline, fault, "--output", output);
    const comparison = JSON.parse(await readFile(output, "utf8"));
    assert.equal(comparison.results[0].changed, true);
    assert.equal(comparison.results[0].before.actual.action, "ban");
    assert.equal(comparison.results[0].after.failure, "invalid-output");
    assert.throws(() => run("--paid", "--output", join(dir, "paid.json")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("comparison exposes prompt changes and rejects edited reports", async () => {
  const { writeFile } = await import("node:fs/promises");
  const dir = await mkdtemp(join(tmpdir(), "hero-evaluation-"));
  try {
    const config = join(dir, "config.json");
    await writeFile(
      config,
      JSON.stringify({
        version: "qa-override-1",
        prompt: "Synthetic alternate prompt for provenance comparison.",
      }),
    );
    const before = join(dir, "before.json");
    const after = join(dir, "after.json");
    run("--case", "private-contact", "--output", before);
    run(
      "--case",
      "private-contact",
      "--configuration",
      config,
      "--output",
      after,
    );
    const output = join(dir, "comparison.json");
    run("--compare", before, after, "--output", output);
    const comparison = JSON.parse(await readFile(output, "utf8"));
    assert.ok(comparison.differences.some((d) => d.field === "promptHash"));
    assert.ok(comparison.differences.some((d) => d.field === "configuration"));
    const tampered = JSON.parse(await readFile(after, "utf8"));
    tampered.results[0].actual.action = "ban";
    await writeFile(after, JSON.stringify(tampered));
    assert.throws(() =>
      run("--compare", before, after, "--output", join(dir, "invalid.json")),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("English audit success and controlled failure leave the original Spanish judgment unchanged", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hero-evaluation-"));
  try {
    const success = join(dir, "success.json");
    const failure = join(dir, "failure.json");
    run("--case", "spanish-original", "--output", success);
    run(
      "--case",
      "spanish-original",
      "--controlled-translation-failure",
      "--output",
      failure,
    );
    const a = JSON.parse(await readFile(success, "utf8")).results[0];
    const b = JSON.parse(await readFile(failure, "utf8")).results[0];
    assert.equal(a.translation.status, "available");
    assert.equal(a.translation.excerpts[0].pointer, "/text");
    assert.match(a.translation.excerpts[0].original, /Tengo copias/u);
    assert.match(a.translation.excerpts[0].english, /unauthorized copies/u);
    assert.equal(b.translation.status, "unavailable");
    assert.deepEqual(b.actual, a.actual);
    assert.deepEqual(b.expected, a.expected);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("report sanitization removes credential echoes even when JSON escaping is needed", async () => {
  const { writeFile } = await import("node:fs/promises");
  const dir = await mkdtemp(join(tmpdir(), "hero-evaluation-"));
  try {
    const secret = 'synthetic-secret-"quoted"\nvalue';
    const config = join(dir, "config.json");
    await writeFile(
      config,
      JSON.stringify({
        version: "sanitization",
        prompt: `Synthetic ${secret}`,
      }),
    );
    const output = join(dir, "report.json");
    execFileSync(
      process.execPath,
      [
        runner,
        "--case",
        "private-contact",
        "--configuration",
        config,
        "--output",
        output,
      ],
      {
        stdio: "pipe",
        env: { ...process.env, HERO_TEST_SECRET: secret },
      },
    );
    const report = JSON.parse(await readFile(output, "utf8"));
    assert.equal(report.configuration.prompt, "Synthetic [REDACTED]");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
