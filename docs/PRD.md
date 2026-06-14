# Ritual PRD

## Summary

Ritual is a zero-friction interactive CLI that turns repeated coding-agent prompts into reusable skills.

The product wedge is:

> Your coding-agent history already contains the workflows you repeat. This CLI finds them, ranks them, and turns the best ones into reusable skills.

Ritual is not a history viewer. The history scan exists only to discover repeated workflows that are good candidates for skills. The MVP succeeds when a user creates one high-quality reusable `SKILL.md` from repeated Claude or Codex prompts.

## Problem

Developers repeatedly ask coding agents to perform similar tasks: refactors, reviews, documentation updates, test generation, release preparation, bug triage, and repo-specific workflows. Those workflows are usually scattered across local agent history and rarely get promoted into reusable instructions.

Existing history tools help users inspect what happened. Existing skill generators help package a workflow once the user already knows what to encode. Ritual connects those categories by finding repeated workflows inside real agent history and turning the best candidate into a reusable skill.

## Target Users

- Developers who use Claude Code, Codex, or both for recurring coding tasks.
- Maintainers who want repo-specific or personal agent skills without manually mining old sessions.
- Power users who want to standardize successful prompts and workflows across projects.

## Product Principles

- The interface has one command: `npx ritual@latest`.
- There are no MVP subcommands.
- There are no MVP CLI flags.
- All decisions happen through interactive prompts.
- The primary artifact is one high-quality `SKILL.md`.
- The user must approve before any skill is written.
- History data stays local by default.
- Candidate discovery is local-only in the MVP.

## Goals

- Scan local Claude and Codex history sources.
- Extract user prompts only.
- Cluster similar prompts into repeated workflow candidates.
- Rank candidates by recurrence, coherence, and likely usefulness.
- Present top candidates interactively.
- Let the user approve, merge, rename, or reject candidates.
- Generate one skill per run.
- Use an embedded, versioned skill-generation prompt derived from `skill-creator`.
- Call a local coding-agent executable, such as `claude` or `codex exec`, only after user approval.
- Let the user edit the draft before final validation and write.
- Validate generated skill drafts with built-in `SKILL.md` checks and, when available, `agnix`.
- Write the same approved `SKILL.md` to Claude, Codex/agents, or both selected targets.

## Non-Goals

- Fully automatic skill generation without review.
- A full-featured agent history browser.
- Batch skill generation.
- Subcommand-driven workflows.
- CLI flags for MVP behavior.
- Cloud sync, hosted accounts, or shared team skill registries.
- Uploading history for semantic clustering.
- Deep semantic indexing across complete assistant responses.
- Guaranteeing that generated skills are correct without user review.

## MVP User Flow

1. The user runs `npx ritual@latest`.
2. Ritual discovers local Claude and Codex history files.
3. Ritual reports source-level diagnostics, including how many prompts were extracted from each source.
4. Ritual extracts only user-authored prompts.
5. Ritual normalizes and clusters similar prompts locally.
6. Ritual ranks repeated workflow candidates.
7. Ritual shows an interactive list of top candidates.
8. The user opens candidate details and reviews representative prompts.
9. The user can approve, merge, rename, or reject candidates.
10. Ritual recommends whether the selected candidate appears project-specific or global.
11. The user chooses project-local or global skill scope.
12. The user chooses Claude, Codex/agents, or both output ecosystems.
13. Ritual calls a local agent executable to draft a skill for the approved candidate.
14. Ritual writes the temporary draft to `.ritual/drafts/<skill-name>/SKILL.md`.
15. The user reviews and may edit the draft before final validation.
16. Ritual validates the draft.
17. Ritual shows blocking errors and quality warnings.
18. The user approves the final write.
19. Ritual writes the same `SKILL.md` to the selected target path or paths.
20. Ritual prints the final paths.

## Functional Requirements

### Invocation

- The MVP command is `npx ritual@latest`.
- The MVP must not require users to learn subcommands.
- The MVP must not require users to remember flags.
- Runtime choices must be made through interactive prompts.
- Internal implementation may still use modules for scan, cluster, draft, validate, and write.

### History Discovery

- Detect supported Claude history locations.
- Detect supported Codex history locations.
- Ask interactively for additional history paths when automatic discovery is incomplete.
- Report which sources were scanned.
- Report prompt extraction counts per source.
- Allow partial support with clear diagnostics when one source cannot be parsed.
- Do not require network access for history scanning.

### Prompt Extraction

- Extract user prompts only.
- Exclude assistant responses, tool outputs, system messages, and metadata unless needed for parsing.
- Preserve enough source metadata to show where each prompt came from.
- Handle malformed or partially written history records without crashing.
- Continue scanning other sources if one source fails.

### Prompt Normalization

- Normalize superficial differences such as whitespace and casing where useful.
- Preserve the original prompt text for review.
- Avoid stripping details that distinguish different workflows.
- Keep enough representative prompt text to support high-quality skill generation.

### Clustering

- Group similar user prompts into workflow candidates.
- Use local-only clustering in the MVP.
- Support repeated prompts that are semantically similar but not identical.
- Default strong-candidate threshold to 3 similar prompts.
- Let the user interactively lower the threshold to 2 when results are sparse.
- Keep representative examples for each cluster.
- Allow the user to merge clusters during review.

### Ranking

- Rank candidates by repeat count.
- Rank candidates by cluster coherence.
- Prefer candidates with enough prompt detail to produce a useful skill.
- De-prioritize one-off, vague, or low-signal prompts.
- Show the reason each candidate ranked highly.
- If no candidate meets the strong threshold, show near-misses and do not generate by default.

### Interactive Review

- Display top repeated workflow candidates in the terminal.
- Show candidate name, count, summary, rank reason, and representative prompts.
- Let the user approve one candidate.
- Let the user reject candidates.
- Let the user rename the approved candidate.
- Let the user merge related candidates before drafting.
- Generate at most one skill per run.

### Scope Selection

- Recommend project-local or global scope based on the selected prompt cluster.
- Mark candidates as likely project-specific when prompts mention repo files, local commands, framework choices, CI, package managers, or project names.
- Mark candidates as likely global when prompts are tool- or task-generic.
- Require user confirmation of scope.
- Default to project-local scope when run inside a repository.
- Resolve project-local paths relative to the current directory where `npx ritual@latest` was run.

### Output Ecosystem Selection

- Let the user select Claude, Codex/agents, or both.
- Write the same generated `SKILL.md` to every selected target.
- Do not generate ecosystem-specific variants in the MVP.
- Do not create ecosystem-specific metadata files in the MVP.

Target paths:

- Project-local Claude: `./.claude/skills/<name>/SKILL.md`
- Project-local Codex/agents: `./.agents/skills/<name>/SKILL.md`
- Global Claude: the user's global Claude skills directory
- Global Codex/agents: the user's global agents skills directory

When run inside a repository, the recommended default is project-local scope and both ecosystems.

### Skill Drafting

- Use an embedded, versioned skill-generation prompt derived from `skill-creator`.
- Do not load the user's installed `skill-creator` at runtime for default behavior.
- Include the approved candidate name, representative prompts, rank rationale, selected scope, and selected ecosystem targets in the drafting prompt.
- Call a local agent executable to draft the skill only after user approval.
- Support `claude` when available.
- Support `codex exec` when available.
- Make the agent invocation explicit before running it because local agent tools may call external services depending on user configuration.
- Do not improvise the skill-generation prompt per candidate.

The generated skill must be high quality. It should use the shared `SKILL.md` format:

- A lowercase hyphen-case skill name.
- YAML frontmatter with only `name` and `description`.
- A trigger-rich `description` that explains when the skill should be used.
- A concise Markdown body written as actionable instructions.
- Imperative or infinitive instruction style.
- No `README.md`, changelog, installation guide, or unrelated auxiliary docs.
- Optional `scripts/`, `references/`, or `assets/` only when the repeated workflow clearly needs them.

### Draft Editing

- Write temporary drafts to `.ritual/drafts/<skill-name>/SKILL.md`.
- Let the user inspect the draft before writing it to a skill root.
- Offer to open the draft in `$EDITOR` when available.
- Fall back to an approve, reject, or retry prompt when `$EDITOR` is unavailable.
- Validate after the user has had a chance to edit.
- Ask interactively whether to keep or delete the draft workspace after final write.

### Validation

- Validate that the draft contains a `SKILL.md`.
- Validate YAML frontmatter format.
- Validate that frontmatter contains only `name` and `description`.
- Validate that `name` is lowercase hyphen-case.
- Validate that `description` includes clear trigger contexts.
- Validate that the body is not empty.
- Validate that the body is not placeholder text.
- Use `agnix` validation when available.
- Fall back to built-in checks when `agnix` is unavailable.
- Report validation errors and warnings before writing.

Blocking errors:

- Missing `SKILL.md`.
- Invalid YAML frontmatter.
- Frontmatter fields other than `name` and `description`.
- Invalid skill name.
- Missing or weak trigger description.
- Empty or mostly placeholder body.

Warnings:

- Body is too generic.
- Body repeats obvious model capabilities.
- Body lacks concrete workflow steps.
- Body exceeds a configured length threshold.
- Body mentions bundled resources but no files are present.

### Skill Output

- Create parent directories when needed.
- Avoid overwriting an existing skill unless the user confirms interactively.
- Sanitize skill names for filesystem-safe paths.
- Write the same final `SKILL.md` to all selected targets.
- Print the final path or paths after writing.

## Data Handling Requirements

- Treat local history as sensitive developer data.
- Do not upload history by default.
- Extract and process history locally.
- Keep scan and cluster results ephemeral by default.
- Ask interactively before saving any session data.
- If saved, store review session data under `.ritual/sessions/` with clear contents.
- Make agent invocation explicit because drafting may use external model services through the user's local agent configuration.

## Success Metrics

- The user can create one valid reusable skill from repeated history in one interactive session.
- The top ranked candidates contain workflows the user recognizes as repeated.
- The user can reject noise without editing files manually.
- The user can review and edit the generated draft before writing.
- A generated skill passes structural validation.
- The output path matches the selected scope and ecosystem targets.
- The CLI can be used successfully with only `npx ritual@latest`.

## MVP Acceptance Criteria

- Given local Claude and Codex history sources, Ritual extracts user prompts without assistant content.
- Given one unsupported or malformed source, Ritual reports diagnostics and continues with any supported sources.
- Given a set of repeated prompts, Ritual clusters them into visible workflow candidates locally.
- Given clustered candidates, Ritual ranks and presents the top candidates interactively.
- Given no strong candidate, Ritual shows near-misses and does not generate by default.
- Given two similar candidates, the user can merge them before drafting.
- Given an approved candidate, Ritual can invoke `claude` or `codex exec` locally to create a high-quality draft skill using the embedded skill-generation prompt.
- Given a draft skill, the user can edit it before final validation.
- Given a draft skill, Ritual blocks writes on structural validation failures.
- Given warning-only validation results, Ritual lets the user decide whether to continue.
- Given a valid approved draft, Ritual writes the same `SKILL.md` to Claude, Codex/agents, or both selected targets.
- Given a run inside a repository, Ritual recommends project-local scope and both ecosystems by default.

## Open Questions

- Which Claude and Codex history file formats should be supported first?
- What exact lexical similarity algorithm should be used for local-only clustering?
- What should the built-in skill-generation prompt versioning scheme look like?
- What are the exact global Claude and global Codex/agents skill directories on each supported operating system?
- Should generated skills include provenance comments linking back to source prompt examples, or would that leak too much history into reusable artifacts?
- What length threshold should trigger a warning for an overly long `SKILL.md`?

## Implementation Assumptions

- Claude and Codex history are available as local files on the user's machine.
- At least one local drafting executable, `claude` or `codex`, may be installed.
- `agnix` may not be installed, so built-in validation is required for the MVP.
- User approval is required before any generated skill is written.
- The current working directory is the project-local root for project-specific output.
