# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Add an agent-led discovery pass that hands local session/history paths to the selected local agent, reads structured JSON findings back into the CLI, and lets the user choose which finding should become a skill inside the same Ritual session.

### Changed

- Preserve Ritual's local repeated-workflow ranking as a fallback when agent discovery is declined, unavailable, fails, or returns no usable candidates.

## [0.2.0] - 2026-06-20

### Added

- Add `ritual prompts` and `ritual --prompts` to dump the latest extracted user prompts in descending date order, with `--limit`/`-n` support for changing the default 100-prompt count.

### Changed

- Scan Claude project transcripts plus Codex active and archived session transcripts by default, while preserving prompt-history file discovery and honoring `CLAUDE_CONFIG_DIR` and `CODEX_HOME`.
- Prefer the most recent matching prompts in workflow previews so newly repeated prompts are visible when reviewing candidates.

### Fixed

- Exclude newer Codex `# AGENTS.md instructions` context records from user-prompt extraction.
- Skip slash commands, low-signal acknowledgements, skill-call context, structured payloads, terminal transcripts, standalone attachments, injected runtime events, local page checks, rendered output dumps, app logs, risk reports, CI log dumps, generated handoffs, assistant completion summaries, and assistant review reports during prompt extraction, and deduplicate mirrored prompt-history/session records before ranking or dumping prompts.

## [0.1.1] - 2026-06-15

### Fixed

- Run the CLI when package managers invoke the `ritualai` binary through a `.bin` symlink.

## [0.1.0] - 2026-06-15

### Added

- Existing-skill duplicate detection that skips recurring prompt candidates already covered by project-local or global Claude/Codex skills.
- Initial product requirements for Ritual as an interactive CLI that turns repeated Claude and Codex prompts into reusable skills.
- Technical specification for the TypeScript, Biome, typecheck, Bun package-manager workflow, npm registry distribution, and tag-driven GitHub Actions release architecture.
- Production TypeScript CLI scaffold with strict ESM build output and Bun-managed `ritual` executable.
- Local Claude and Codex JSON/JSONL history discovery, resilient user-prompt extraction, and source diagnostics.
- Local prompt normalization, lexical clustering, recurrence ranking, candidate selection, and two-match fallback handling.
- Project/global scope selection, Claude and Codex/agents target resolution, safe skill-name sanitization, and overwrite protection.
- Explicitly approved `claude` or `codex` drafting with an embedded versioned skill-generation prompt.
- Direct skill writes to selected target paths with built-in `SKILL.md` validation and optional `agnix`.
- Unit and integration tests covering parsers, ranking, path safety, validation, and the full fixture-driven session flow.
- GitHub Actions CI and tag-driven Bun release workflow.
- Release-note extraction from `CHANGELOG.md` for GitHub Releases created by CI.

### Changed

- Launch Claude or Codex as an inherited terminal session for skill drafting, passing the generated skill prompt as the final argv argument and validating the draft file the agent writes.
- Simplified the skill generation flow by removing the draft workspace, global-write confirmation, launch confirmation, final-write confirmation, editor prompt, validation warning prompt, and draft cleanup prompt.
- Refactored the Ritual CLI entrypoint into a reusable runtime lifecycle wrapper with signal handling, stdin cleanup, help normalization, and top-level error funneling while preserving the one-command/no-flags MVP contract.
- Switched the project package manager from npm to Bun, replacing `package-lock.json` with `bun.lock` and updating local, CI, and release commands to use `bun`.
- Made the interactive candidate-review flow friendlier by replacing raw internal slugs, lexical-coherence details, and near-miss terminology with plain workflow summaries and actions.
- Move directly from choosing a repeated workflow into local-agent draft setup instead of showing a second approval menu.
- Detect available local draft generators and ask the user to choose Claude Code or Codex before creating the `SKILL.md` draft, instead of silently preferring the first executable found.
- Summarize scanned history sources and repeated diagnostics so users see concise totals instead of a long line-by-line dump for every skipped session file.
- Cleanly handle terminal prompt cancellation and release stdin after the interactive CLI settles.
- Use Codex prompt history from `~/.codex/history.jsonl` as the default Codex source instead of full session transcripts.
- Use Claude prompt history from `~/.claude/history.jsonl`, honoring `CLAUDE_CONFIG_DIR`, as the default Claude source instead of full session transcripts.
- Configure Bun release publishing to use npm automation token authentication in CI.
- Rename the npm package to `ritualai` while keeping `ritual` as a binary alias.

### Fixed

- Let the ranking progress spinner animate during repeated-workflow clustering by yielding through the async ranking path.
- Removed stale draft wording from the direct skill generation flow and made successful progress spinners clear without printing `ok ...` status lines.
- Avoid Node's unsettled top-level-await warning during interactive prompts by deferring stdin unref cleanup until the CLI session settles.
- Parse real Codex session `response_item.payload` records so user-authored prompts are extracted from `~/.codex/sessions`.
- Ignore injected Codex context blocks such as environment metadata, app/plugin instructions, skill instructions, and `AGENTS.md` context when extracting user prompts.
- Avoid generating suggested skill names from attachment/path noise such as image filenames and local filesystem fragments.
