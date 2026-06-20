# RitualAI

RitualAI is an interactive TypeScript CLI that scans local Claude and Codex prompt
history, finds repeated workflow candidates, and guides one approved candidate into
a reusable `SKILL.md`.

## Usage

Published usage:

```bash
npx ritualai@latest
npx ritualai@latest --help
```

Dump the latest 100 extracted user prompts, newest first:

```bash
npx ritualai@latest prompts
npx ritualai@latest --prompts
```

Use a different prompt count:

```bash
npx ritualai@latest prompts --limit 25
```

Local development usage:

```bash
bun install --frozen-lockfile
bun run build
node dist/cli/main.js
node dist/cli/main.js prompts
bun run dev --prompts
```

Running without arguments starts the interactive skill-generation flow.

## What The CLI Does

1. Discovers supported Claude and Codex history files.
2. Extracts user-authored prompts only for diagnostics and local fallback ranking.
3. Asks whether a local agent should inspect the discovered session/history paths for skill candidates.
4. Opens the selected agent in the current terminal with the discovered paths and discovery instructions.
5. The agent reviews the listed sessions, presents a Markdown table, gives an opinionated recommendation, and asks which skill or skills to implement.
6. The agent continues in that same window after the user answers.
7. Ritual falls back to local repeated-workflow ranking only when agent discovery is declined, unavailable, or exits unsuccessfully.

The `prompts` command skips candidate ranking and writes raw extracted user
prompts to stdout as tab-separated `createdAt`, source, and prompt text fields.

## Privacy

History discovery, extraction, and fallback ranking are local-only. Ritual does
not upload history itself. Agent discovery and skill generation use a local
`claude` or `codex` executable only after the user chooses it, because those tools
may call external services depending on the user's configuration. The discovery
agent receives local session/history paths and interacts with the user in the
agent window. It must not write files during discovery. The command's working
directory is not part of discovery input; the discovery agent is instructed to
review only the listed stored sessions/history files and not inspect the
repository or other host-machine files during discovery, except for existing
project/global skill directories so already-covered workflows can be suppressed.
Before writing any selected skill, the agent must ask whether to install it
project-local to the current command path or globally under the user's home
directory, showing the concrete target paths for both choices.

Tests use fixtures and temporary directories. They do not read real Claude or Codex
history.

## Supported History Sources

Ritual scans these defaults when they exist:

- Claude: `~/.claude/history.jsonl` (or `$CLAUDE_CONFIG_DIR/history.jsonl`)
- Claude transcripts: `~/.claude/projects/**/*.jsonl` (or
  `$CLAUDE_CONFIG_DIR/projects/**/*.jsonl`)
- Codex: `$CODEX_HOME/history.jsonl` (defaults to `~/.codex/history.jsonl`)
- Codex transcripts: `$CODEX_HOME/sessions/**/*.jsonl` and
  `$CODEX_HOME/archived_sessions/**/*.jsonl`

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
- Large history sources can be partially skipped by bounded discovery and scan caps;
  use a narrower extra source and restart with a larger explicit option from code,
  or place smaller history extracts in dedicated files.
- Missing `claude` and `codex`: Ritual can still rank repeated prompts locally,
  but install one supported local agent executable before drafting.
- Missing `$EDITOR`: Ritual continues with prompt-based review and validation.
- Missing `agnix`: built-in validation still runs and is sufficient for MVP use.

## Release

Release automation runs on `v*` tag pushes. The release workflow installs with
`bun install --frozen-lockfile`, runs `bun run verify`, audits package contents with
`bun run pack:dry-run`, publishes to the npm registry with `bun publish`, and creates
a GitHub Release.
