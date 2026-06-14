# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial product requirements for Ritual as an interactive CLI that turns repeated Claude and Codex prompts into reusable skills.
- Technical specification for the TypeScript, Biome, typecheck, npm distribution, and tag-driven GitHub Actions release architecture.
- Production TypeScript CLI scaffold with strict ESM build output and npm `ritual` executable.
- Local Claude and Codex JSON/JSONL history discovery, resilient user-prompt extraction, and source diagnostics.
- Local prompt normalization, lexical clustering, recurrence ranking, candidate review, rename, reject, merge, and near-miss handling.
- Project/global scope selection, Claude and Codex/agents target resolution, safe skill-name sanitization, and overwrite protection.
- Explicitly approved `claude` or `codex exec` drafting with an embedded versioned skill-generation prompt.
- Draft workspace creation, optional `$EDITOR` review, built-in `SKILL.md` validation with optional `agnix`, final writes, and draft cleanup choice.
- Unit and integration tests covering parsers, ranking, path safety, validation, and the full fixture-driven session flow.
- GitHub Actions CI and tag-driven npm release workflow.
