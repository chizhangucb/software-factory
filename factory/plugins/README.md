# Vendored plugins

Skills the factory prompts invoke by name. `factory/lib/plugins.ts` copies every directory here into the account's `CLAUDE_CONFIG_DIR/skills/` before each attempt, where Claude Code loads it as `<name>@skills-dir` and namespaces its skills as `<name>:<skill>`.

## The pin

| | |
| --- | --- |
| Plugin | `mattpocock-skills` |
| Version | 1.2.3 |
| Marketplace | `claude-plugins-official` |
| `gitCommitSha` | `0ab1b63a410a03d3627979a109c8695de27af954` |
| Upstream | https://github.com/mattpocock/skills |
| Licence | MIT, `mattpocock-skills/LICENSE` |

Copied verbatim: `.claude-plugin/plugin.json`, `LICENSE`, and the 25 skills the manifest declares, which live under `skills/engineering/` and `skills/productivity/`. Upstream's `skills/deprecated/`, `skills/in-progress/` and `skills/misc/` declare no skill in the manifest and are not copied, so an upstream diff of this folder is a diff of the plugin.

## Why vendored rather than installed

`claude plugin install` takes a plugin and a marketplace, and no version; `claude plugin update` goes to the latest. `claude plugin marketplace add` pins no ref either. So a marketplace install on a runner would drift with the marketplace and could not be pinned to 1.2.3. Vendoring is the only pin available, and it also keeps the runner off the network for its skills.

## Bumping

1. Update the local install (`claude plugin update mattpocock-skills`) and read the new version and `gitCommitSha` from `claude plugin list`.
2. Re-copy the four paths above from `~/.claude/plugins/cache/claude-plugins-official/mattpocock-skills/<version>/`.
3. Update the table above.
4. Update the version in `factory/lib/plugins.test.ts`, which pins it, and run `npm test`. It also asserts that every skill the prompts name is installed and that every declared skill has a `SKILL.md`, so a bump that drops one goes red.
5. Prove it on the fixture: one ticket whose run log shows the `skill <name> <args>` lines.
