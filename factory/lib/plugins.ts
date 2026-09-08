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
 * engine, and are copied in before each run: the marketplace installer takes
 * no version, so vendoring is the only way to pin one (`factory/plugins/README.md`
 * records the pin and how to bump it). Skills the harness itself bundles are
 * `harness.ts`.
 */
export const FACTORY_PLUGINS_DIR = path.join(import.meta.dirname, "..", "plugins");

/** One vendored plugin, as it now sits in an account's config dir. */
export interface InstalledPlugin {
  readonly name: string;
  /** The pinned version, from the plugin's own manifest. */
  readonly version: string;
  /** The skills it declares, by the name a prompt invokes them under. */
  readonly skills: readonly string[];
}

/** A plugin's pinned version and the skills it declares, from its own manifest. */
const readManifest = (pluginDir: string): Omit<InstalledPlugin, "name"> => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(pluginDir, ".claude-plugin", "plugin.json"), "utf8"),
  ) as { version?: unknown; skills?: unknown };
  const declared = Array.isArray(manifest.skills) ? manifest.skills : [];
  return {
    version: typeof manifest.version === "string" ? manifest.version : "unknown",
    // Declared as paths (`./skills/engineering/tdd`); a prompt invokes the last segment.
    skills: declared.filter((s): s is string => typeof s === "string").map((s) => path.basename(s)),
  };
};

/**
 * Copy every vendored plugin into `configDir/skills/`, and report what the
 * run now has: the pinned version and the skills a prompt may invoke. The
 * job log carries that line, so a run whose prompt names a skill the pin
 * does not ship is visible in the log rather than only in the agent's
 * confusion.
 */
export const installFactoryPlugins = (configDir: string): InstalledPlugin[] => {
  const skillsDir = path.join(configDir, "skills");
  fs.mkdirSync(skillsDir, { recursive: true });
  const names = fs
    .readdirSync(FACTORY_PLUGINS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return names.map((name) => {
    const target = path.join(skillsDir, name);
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(path.join(FACTORY_PLUGINS_DIR, name), target, { recursive: true });
    return { name, ...readManifest(target) };
  });
};

/**
 * Install into the config dir of the account an attempt is running on, and
 * log the pin and the skills. Both implementer runs call this: rotation gives
 * each account its own config dir, so the skills their prompts invoke by name
 * have to be put in the dir of the account this attempt drew.
 */
export const installPluginsForAttempt = (configDir: string | undefined): void => {
  if (!configDir) throw new Error("The agent has no CLAUDE_CONFIG_DIR.");
  for (const plugin of installFactoryPlugins(configDir)) {
    console.log(
      `Installed ${plugin.name} ${plugin.version} into ${configDir}: ${plugin.skills.join(", ")}.`,
    );
  }
};
