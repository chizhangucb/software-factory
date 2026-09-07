import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Skills the factory prompts call by name.
 *
 * Claude Code on the runner starts from a fresh config dir with no plugins,
 * so anything a prompt invokes as `<plugin>:<skill>` must be put there first.
 * Claude Code auto-loads any plugin directory under `<config dir>/skills/`
 * as `<name>@skills-dir`, namespacing its skills as `<name>:<skill>`. The
 * plugins live vendored under `factory/plugins/`, pinned like the rest of the
 * engine, and are copied in before each run. Bundled skills (`code-review`,
 * `simplify`) ship inside the CLI and need nothing.
 */
export const FACTORY_PLUGINS_DIR = path.join(import.meta.dirname, "..", "plugins");

/** Copy every vendored plugin into `configDir/skills/`; returns the plugin names. */
export const installFactoryPlugins = (configDir: string): string[] => {
  const skillsDir = path.join(configDir, "skills");
  fs.mkdirSync(skillsDir, { recursive: true });
  const names = fs
    .readdirSync(FACTORY_PLUGINS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of names) {
    const target = path.join(skillsDir, name);
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(path.join(FACTORY_PLUGINS_DIR, name), target, { recursive: true });
  }
  return names;
};
