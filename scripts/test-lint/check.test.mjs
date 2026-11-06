import assert from "node:assert/strict";
import { test } from "node:test";
import { ESLint } from "eslint";

const eslint = new ESLint();
const forms = [
  "it",
  "it.each([1])",
  "it.effect",
  "it.effect.each([1])",
  "it.live",
  "it.live.each([1])",
];
const filePath = "scripts/test-lint/fixtures/case.ts";
const source = (
  form,
  title,
  body,
) => `import { it, expect } from "@effect/vitest";
import { Effect } from "effect";
${form}("${title}", ${form.includes("effect") || form.includes("live") ? `() => Effect.gen(function* () { ${body} })` : `async () => { ${body} }`});`;
async function messages(code) {
  const [result] = await eslint.lintText(code, { filePath });
  assert.equal(result.fatalErrorCount, 0, JSON.stringify(result.messages));
  return result.messages.map(({ ruleId }) => ruleId);
}

test("focused tests fail and ordinary registrations pass in every supported form", async () => {
  for (const form of forms) {
    assert.deepEqual(
      await messages(source(form, "valid", "expect(2).toBe(2);")),
      [],
    );
    const focused = form.replace(/\.each\(\[1\]\)/, ".only.each([1])");
    assert.deepEqual(
      await messages(
        source(
          focused === form ? `${form}.only` : focused,
          "focused",
          "expect(2).toBe(2);",
        ),
      ),
      ["tests/no-focused-tests"],
    );
  }
});

test("skipped and todo registrations fail in every supported form", async () => {
  for (const form of forms) {
    const skipped = form.replace(/\.each\(\[1\]\)/, ".skip.each([1])");
    assert.deepEqual(
      await messages(
        source(
          skipped === form ? `${form}.skip` : skipped,
          "skipped",
          "expect(2).toBe(2);",
        ),
      ),
      ["tests/no-skipped-tests"],
    );
  }
  for (const code of [
    'it.todo("later");',
    'it("missing body");',
    'it.skipIf(true)("conditional", () => {});',
    'describe.skip("suite", () => {});',
  ]) {
    assert.deepEqual(
      await messages(`import { it, describe } from "@effect/vitest"; ${code}`),
      ["tests/no-skipped-tests"],
    );
  }
});

test("duplicate registration titles fail including each declarations", async () => {
  for (const form of forms) {
    const first = source(form, "same %s", "expect(2).toBe(2);");
    const second = source(form, "same %s", "expect(2).toBe(2);")
      .split("\n")
      .slice(2)
      .join("\n");
    assert.deepEqual(await messages(`${first}\n${second}`), [
      "tests/no-duplicate-titles",
    ]);
    assert.deepEqual(
      await messages(`${first}\n${second.replace("same %s", "different %s")}`),
      [],
    );
  }
});

test("incomplete assertions fail for the approved expect helper", async () => {
  for (const form of forms) {
    for (const body of [
      "expect(2);",
      "expect(2).toBe;",
      "expect(2).not.resolves.not.toBe(2);",
      "expect().toBe(2);",
    ]) {
      assert.deepEqual(await messages(source(form, "invalid", body)), [
        "vitest/valid-expect",
      ]);
    }
  }
});

test("unawaited asynchronous assertions fail and returned assertions pass", async () => {
  for (const form of forms) {
    assert.deepEqual(
      await messages(
        source(
          form,
          "unawaited",
          "expect(Promise.resolve(2)).resolves.toBe(2);",
        ),
      ),
      ["vitest/valid-expect"],
    );
    const body =
      form.includes("effect") || form.includes("live")
        ? "yield* Effect.promise(() => expect(Promise.resolve(2)).resolves.toBe(2));"
        : "await expect(Promise.resolve(2)).resolves.toBe(2);";
    assert.deepEqual(await messages(source(form, "awaited", body)), []);
    assert.deepEqual(
      await messages(
        source(
          form,
          "rejects",
          "expect(Promise.reject(new Error('bad'))).rejects.toThrow('bad');",
        ),
      ),
      ["vitest/valid-expect"],
    );
  }
});

test("conditional assertions fail even inside Effect generators", async () => {
  for (const form of forms) {
    for (const body of [
      "if (enabled) expect(2).toBe(2);",
      "enabled && expect(2).toBe(2);",
      "enabled ? expect(2).toBe(2) : undefined;",
      "try {} catch { expect(2).toBe(2); }",
      "for (const value of values) { expect(value).toBe(2); }",
    ]) {
      assert.deepEqual(await messages(source(form, "conditional", body)), [
        "tests/no-conditional-assertions",
      ]);
    }
    assert.deepEqual(
      await messages(
        source(
          form,
          "unconditional",
          "const value = enabled ? 2 : 3; expect(value).toBe(2);",
        ),
      ),
      [],
    );
  }
});

test("imports may be aliased; shadowed and unrelated functions are not tests", async () => {
  assert.deepEqual(
    await messages(
      'import { it as scenario, expect as verify } from "@effect/vitest"; scenario.live.only("focused", () => Effect.void);',
    ),
    ["tests/no-focused-tests"],
  );
  assert.deepEqual(
    await messages(
      'import { expect as verify } from "@effect/vitest"; if (enabled) verify(2).toBe(2);',
    ),
    ["tests/no-conditional-assertions"],
  );
  assert.deepEqual(
    await messages(
      'import { expect as verify } from "@effect/vitest"; verify(2);',
    ),
    ["vitest/valid-expect"],
  );
  assert.deepEqual(
    await messages(
      'import { it, expect } from "@effect/vitest"; function helper(it, expect) { it.only("local"); if (enabled) expect(2); }',
    ),
    [],
  );
});

test("suite titles are scoped and each declarations cannot hide duplicates", async () => {
  const imports = 'import { describe, it, expect } from "vitest";';
  const registration = 'it.each([1])("same %s", () => { expect(2).toBe(2); });';
  assert.deepEqual(
    await messages(
      `${imports} describe("one", () => { ${registration} }); describe("two", () => { ${registration} });`,
    ),
    [],
  );
  assert.deepEqual(
    await messages(
      `${imports} describe("one", () => {}); describe("one", () => {});`,
    ),
    ["tests/no-duplicate-titles"],
  );
  assert.deepEqual(
    await messages(`${imports} describe.only("one", () => {});`),
    ["tests/no-focused-tests"],
  );
});

test("the CI lint command rejects isolated invalid files with exit 1", async () => {
  const { mkdir, mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { spawnSync } = await import("node:child_process");
  await mkdir("scripts/test-lint/fixtures", { recursive: true });
  const directory = await mkdtemp("scripts/test-lint/fixtures/probe-");
  try {
    const path = `${directory}/case.ts`;
    for (const [form, body, expected] of [
      ["it.live", "expect(2).toBe(2);", null],
      ["it.effect.only", "expect(2).toBe(2);", "tests/no-focused-tests"],
      ["it.live.skip", "expect(2).toBe(2);", "tests/no-skipped-tests"],
      ["it.effect.each([1])", "expect(2);", "vitest/valid-expect"],
      [
        "it.live.each([1])",
        "expect(Promise.resolve(2)).resolves.toBe(2);",
        "vitest/valid-expect",
      ],
      [
        "it.effect",
        "if (enabled) expect(2).toBe(2);",
        "tests/no-conditional-assertions",
      ],
    ]) {
      await writeFile(path, source(form, "probe", body));
      const result = spawnSync(
        process.execPath,
        ["node_modules/eslint/bin/eslint.js", path, "--max-warnings", "0"],
        { encoding: "utf8" },
      );
      assert.equal(
        result.status,
        expected ? 1 : 0,
        result.stdout + result.stderr,
      );
      if (expected) assert.ok(result.stdout.includes(expected), result.stdout);
    }
    await writeFile(
      path,
      `${source("it.live.each([1])", "duplicate", "expect(2).toBe(2);")}\nit.live.each([1])("duplicate", () => Effect.void);`,
    );
    const result = spawnSync(
      process.execPath,
      ["node_modules/eslint/bin/eslint.js", path],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.ok(
      result.stdout.includes("tests/no-duplicate-titles"),
      result.stdout,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("option objects cannot enable focus or skip", async () => {
  for (const [option, expected] of [
    ["only", "tests/no-focused-tests"],
    ["skip", "tests/no-skipped-tests"],
    ["todo", "tests/no-skipped-tests"],
  ]) {
    assert.deepEqual(
      await messages(
        `import { it } from "vitest"; it("options", { ${option}: true }, () => {});`,
      ),
      [expected],
    );
    assert.deepEqual(
      await messages(
        `import { it } from "vitest"; it("options", { ${option}: false }, () => {});`,
      ),
      [],
    );
  }
});

test("promise rejection handlers cannot hide conditional assertions", async () => {
  for (const form of forms) {
    assert.deepEqual(
      await messages(
        source(
          form,
          "caught",
          "Promise.resolve(2).catch(() => { expect(2).toBe(2); });",
        ),
      ),
      ["tests/no-conditional-assertions"],
    );
  }
});

test("approved negated and asynchronous rejection assertions pass", async () => {
  for (const form of forms) {
    const body =
      form.includes("effect") || form.includes("live")
        ? "expect(2).not.toBe(3); yield* Effect.promise(() => expect(Promise.reject(new Error('bad'))).rejects.toThrow('bad'));"
        : "expect(2).not.toBe(3); await expect(Promise.reject(new Error('bad'))).rejects.toThrow('bad');";
    assert.deepEqual(await messages(source(form, "approved", body)), []);
  }
});

test("returning an async assertion from a generator is not awaiting it", async () => {
  assert.deepEqual(
    await messages(
      source(
        "it.effect",
        "returned promise",
        "return expect(Promise.resolve(2)).resolves.toBe(2);",
      ),
    ),
    ["vitest/valid-expect"],
  );
});
