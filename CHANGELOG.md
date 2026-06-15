# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- React Doctor-style diagnostic contracts, stable rule grouping, diagnostics dump writing, and top-three handoff prompt construction for the internal CLI refactor.
- Initial product requirements for Ritual as an interactive CLI that turns repeated Claude and Codex prompts into reusable skills.
- Technical specification for the TypeScript, Biome, typecheck, Bun package-manager workflow, npm registry distribution, and tag-driven GitHub Actions release architecture.
- Production TypeScript CLI scaffold with strict ESM build output and Bun-managed `ritual` executable.
- Local Claude and Codex JSON/JSONL history discovery, resilient user-prompt extraction, and source diagnostics.
- Local prompt normalization, lexical clustering, recurrence ranking, candidate selection, and two-match fallback handling.
- Project/global scope selection, Claude and Codex/agents target resolution, safe skill-name sanitization, and overwrite protection.
- Explicitly approved `claude` or `codex exec` drafting with an embedded versioned skill-generation prompt.
- Draft workspace creation, optional `$EDITOR` review, built-in `SKILL.md` validation with optional `agnix`, final writes, and draft cleanup choice.
- Unit and integration tests covering parsers, ranking, path safety, validation, and the full fixture-driven session flow.
- GitHub Actions CI and tag-driven Bun release workflow.

### Changed

- Switched the project package manager from npm to Bun, replacing `package-lock.json` with `bun.lock` and updating local, CI, and release commands to use `bun`.
- Made the interactive candidate-review flow friendlier by replacing raw internal slugs, lexical-coherence details, and near-miss terminology with plain workflow summaries and actions.
- Move directly from choosing a repeated workflow into local-agent draft setup instead of showing a second approval menu.
- Detect available local draft generators and ask the user to choose Claude Code or Codex before creating the `SKILL.md` draft, instead of silently preferring the first executable found.
- Summarize scanned history sources and repeated diagnostics so users see concise totals instead of a long line-by-line dump for every skipped session file.

### Fixed

- Parse real Codex session `response_item.payload` records so user-authored prompts are extracted from `~/.codex/sessions`.
- Ignore injected Codex context blocks such as environment metadata, app/plugin instructions, skill instructions, and `AGENTS.md` context when extracting user prompts.
- Avoid generating suggested skill names from attachment/path noise such as image filenames and local filesystem fragments.
