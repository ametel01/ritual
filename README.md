# Ritual

Ritual is an interactive TypeScript CLI that scans local Claude and Codex prompt
history, finds repeated workflow candidates, and guides one approved candidate into
a reusable `SKILL.md`.

## Usage

Published usage:

```bash
bunx ritual@latest
```

Local development usage:

```bash
bun install --frozen-lockfile
bun run build
node dist/cli/main.js
```

The MVP has one interactive command. It does not expose subcommands or flags.

## What The CLI Does

1. Discovers supported Claude and Codex history files.
2. Extracts user-authored prompts only.
3. Normalizes, clusters, and ranks repeated workflow candidates locally.
4. Lets the user choose one repeated workflow and preview matching local prompts.
5. Recommends project-local or global skill scope.
6. Lets the user choose Claude, Codex/agents, or both output ecosystems.
7. Lets the user choose Claude Code or Codex for local skill generation.
8. Opens the selected agent in the current terminal with the generated prompt.
9. Writes the skill directly to the first selected target path.
10. Validates the written skill with built-in checks and optional `agnix`.
11. Mirrors the same approved `SKILL.md` to any additional selected targets.

## Privacy

History discovery, extraction, clustering, and ranking are local-only. Ritual does
not upload history. Skill generation uses a local `claude` or `codex` executable
only after the user chooses it, because those tools may call external services
depending on the user's configuration.

Tests use fixtures and temporary directories. They do not read real Claude or Codex
history.

## Supported History Sources

Ritual scans these defaults when they exist:

- Claude: `~/.claude/projects/**/*.json` and `~/.claude/projects/**/*.jsonl`
- Codex: `~/.codex/sessions/**/*.json` and `~/.codex/sessions/**/*.jsonl`

The interactive flow can add one extra Claude or Codex history file or directory.
Malformed records produce diagnostics and do not stop other files from being
scanned.

Ritual skips repeated workflow candidates that are already covered by an existing
project-local or global Claude/Codex skill.

## Output Paths

Project-local targets:

- Claude: `./.claude/skills/<name>/SKILL.md`
- Codex/agents: `./.agents/skills/<name>/SKILL.md`

Global targets:

- Claude: `~/.claude/skills/<name>/SKILL.md`
- Codex/agents on macOS: `~/.agents/skills/<name>/SKILL.md`
- Codex/agents on Linux: `${XDG_CONFIG_HOME:-~/.config}/agents/skills/<name>/SKILL.md`
- Codex/agents on Windows: `%APPDATA%\agents\skills\<name>\SKILL.md`

Existing skill files are never overwritten without interactive confirmation.

## Development

```bash
bun install --frozen-lockfile
bun run check
bun run typecheck
bun run test
bun run build
bun run verify
bun run pack:dry-run
```

`bun run verify` is the aggregate local and CI gate.

## Troubleshooting

- Missing history: add an extra source when prompted, or confirm that supported
  JSON/JSONL files exist in the default directories.
- Unsupported history format: Ritual reports diagnostics and continues with other
  supported files.
- Missing `claude` and `codex`: install one supported local agent executable before
  drafting.
- Missing `$EDITOR`: Ritual continues with prompt-based review and validation.
- Missing `agnix`: built-in validation still runs and is sufficient for MVP use.

## Release

Release automation runs on `v*` tag pushes. The release workflow installs with
`bun install --frozen-lockfile`, runs `bun run verify`, audits package contents with
`bun run pack:dry-run`, publishes to the npm registry with `bun publish`, and creates
a GitHub Release.
