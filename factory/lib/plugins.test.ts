import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { installFactoryPlugins } from "./plugins";

const install = (): { configDir: string; pluginDir: string } => {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-config-"));
  return {
    configDir,
    pluginDir: path.join(configDir, "skills", "mattpocock-skills"),
  };
};

test("the skills the prompts invoke by name are installed, at the pinned version", () => {
  const { configDir } = install();
  const installed = installFactoryPlugins(configDir);

  const plugin = installed.find((p) => p.name === "mattpocock-skills");
  assert.ok(plugin, "mattpocock-skills is vendored");
  assert.equal(plugin.version, "1.2.3");
  for (const skill of ["tdd", "code-review", "resolving-merge-conflicts", "writing-for-agents"]) {
    assert.ok(plugin.skills.includes(skill), `${skill} is installed`);
  }

  fs.rmSync(configDir, { recursive: true, force: true });
});

test("every skill the installed plugin declares has a SKILL.md the runner can load", () => {
  const { configDir, pluginDir } = install();
  const installed = installFactoryPlugins(configDir);

  const manifest = JSON.parse(
    fs.readFileSync(path.join(pluginDir, ".claude-plugin", "plugin.json"), "utf8"),
  ) as { skills: string[] };
  assert.ok(manifest.skills.length > 0);
  for (const declared of manifest.skills) {
    assert.ok(
      fs.existsSync(path.join(pluginDir, declared, "SKILL.md")),
      `${declared}/SKILL.md is on the runner`,
    );
  }
  assert.equal(
    installed.find((p) => p.name === "mattpocock-skills")?.skills.length,
    manifest.skills.length,
  );

  fs.rmSync(configDir, { recursive: true, force: true });
});

test("installFactoryPlugins is idempotent", () => {
  const { configDir } = install();
  assert.deepEqual(installFactoryPlugins(configDir), installFactoryPlugins(configDir));
  fs.rmSync(configDir, { recursive: true, force: true });
});
