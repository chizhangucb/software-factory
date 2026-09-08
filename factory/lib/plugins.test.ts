import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { type TestContext, test } from "node:test";

import { installFactoryPlugins } from "./plugins";

/** A throwaway `CLAUDE_CONFIG_DIR`, removed when the test ends. */
const tempConfigDir = (t: TestContext): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-config-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

const installedPluginDir = (configDir: string): string =>
  path.join(configDir, "skills", "mattpocock-skills");

test("the skills the implementer prompts invoke by name are installed, at the pinned version", (t) => {
  const installed = installFactoryPlugins(tempConfigDir(t));

  const plugin = installed.find((p) => p.name === "mattpocock-skills");
  assert.ok(plugin, "mattpocock-skills is vendored");
  assert.equal(plugin.version, "1.2.3");
  for (const skill of ["tdd", "code-review", "resolving-merge-conflicts"]) {
    assert.ok(plugin.skills.includes(skill), `${skill} is installed`);
  }
});

test("every skill the installed plugin declares has a SKILL.md the runner can load", (t) => {
  const configDir = tempConfigDir(t);
  const installed = installFactoryPlugins(configDir);
  const pluginDir = installedPluginDir(configDir);

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
});

test("installFactoryPlugins is idempotent", (t) => {
  const configDir = tempConfigDir(t);
  assert.deepEqual(installFactoryPlugins(configDir), installFactoryPlugins(configDir));
});
