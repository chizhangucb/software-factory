import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { FACTORY_PLUGINS_DIR, installFactoryPlugins } from "./plugins";

test("installFactoryPlugins copies every vendored plugin into the config dir's skills folder", () => {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-config-"));
  const installed = installFactoryPlugins(configDir);
  assert.ok(installed.includes("mattpocock-skills"));
  const manifest = path.join(
    configDir,
    "skills",
    "mattpocock-skills",
    ".claude-plugin",
    "plugin.json",
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(manifest, "utf8")),
    JSON.parse(
      fs.readFileSync(
        path.join(FACTORY_PLUGINS_DIR, "mattpocock-skills", ".claude-plugin", "plugin.json"),
        "utf8",
      ),
    ),
  );
  assert.ok(
    fs.existsSync(
      path.join(configDir, "skills", "mattpocock-skills", "skills", "code-review", "SKILL.md"),
    ),
  );
  fs.rmSync(configDir, { recursive: true, force: true });
});

test("installFactoryPlugins is idempotent", () => {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-config-"));
  assert.deepEqual(installFactoryPlugins(configDir), installFactoryPlugins(configDir));
  fs.rmSync(configDir, { recursive: true, force: true });
});
