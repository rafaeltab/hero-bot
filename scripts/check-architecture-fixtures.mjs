import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { createArchitectureConfig } from "./architecture-rules.cjs";
import { fixtures } from "./fixtures/architecture.mjs";

const directory = mkdtempSync(".architecture-fixtures-");
try {
  for (const fixture of fixtures) {
    const root = `${directory}/${fixture.name}/src`;
    for (const [name, content] of Object.entries(fixture.files)) {
      const path = `${root}/${name}`;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
    symlinkSync(
      resolve("apps/discord-bot/node_modules"),
      `${root}/node_modules`,
    );
    const capabilities = [
      ...new Set(
        Object.keys(fixture.files)
          .filter((name) => name.startsWith("capabilities/"))
          .map((name) => name.split("/")[1]),
      ),
    ];
    const config = `${directory}/${fixture.name}/config.json`;
    writeFileSync(
      config,
      JSON.stringify(createArchitectureConfig(root, capabilities)),
    );
    const result = spawnSync(
      process.execPath,
      [
        "node_modules/dependency-cruiser/bin/dependency-cruiser.mjs",
        "--config",
        config,
        "--output-type",
        "json",
        root,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.error, undefined);
    const report = JSON.parse(result.stdout);
    const rules = [
      ...new Set(
        report.summary.violations.map((violation) => violation.rule.name),
      ),
    ].sort();
    assert.deepEqual(
      rules,
      [...fixture.rules].sort(),
      `${fixture.name}: ${result.stderr}`,
    );
    const blocking = spawnSync(
      process.execPath,
      [
        "node_modules/dependency-cruiser/bin/dependency-cruiser.mjs",
        "--config",
        config,
        "--output-type",
        "err",
        root,
      ],
      { encoding: "utf8" },
    );
    assert.equal(
      blocking.status === 0,
      fixture.rules.length === 0,
      fixture.name,
    );
    console.log(`Verified ${fixture.name}: ${rules.join(", ") || "allowed"}`);
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
