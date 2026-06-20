# Ritual Technical Specification

## Summary

Ritual is a production-grade TypeScript CLI distributed through the npm registry and executed with:

```bash
bunx ritualai@latest
```

The default application command is the interactive skill-generation flow. The CLI also exposes a narrow `prompts` inspection command that dumps extracted user prompts to stdout without ranking, clustering, or writing skills.

## Runtime And Distribution

- Language: TypeScript.
- Runtime target: active Node.js LTS.
- Package format: ESM.
- Distribution: npm registry.
- User entrypoint: `bunx ritualai@latest`.
- Package `bin` entry: expose the `ritualai` executable and a `ritual` alias.
- Published artifact: compiled JavaScript and required runtime assets only.
- Source maps: included for debuggable production failures.
- Release mechanism: automated GitHub Actions workflow on `v*` tag push.

The CLI must not require a global install. `bunx ritualai@latest` is the primary supported invocation.

## Package Structure

The implementation should keep the interactive shell thin and isolate domain behavior in testable modules.

```text
src/
  cli/
    main.ts
    interactive.ts
    prompt-dump.ts
  history/
    discover.ts
    parse-codex.ts
    parse-claude.ts
    types.ts
  prompts/
    normalize.ts
    cluster.ts
    rank.ts
  skills/
    draft.ts
    generation-template.ts
    validate.ts
    write.ts
    paths.ts
  system/
    exec.ts
    editor.ts
    filesystem.ts
  telemetry/
    diagnostics.ts
  index.ts
test/
  unit/
  integration/
```

Boundaries:

- `cli/` owns terminal interaction only.
- `history/` owns source discovery and parser resilience.
- `prompts/` owns local-only normalization, clustering, and ranking.
- `skills/` owns skill generation prompts, skill validation, target path resolution, and final writes.
- `system/` wraps side-effecting operations so they can be tested.
- `telemetry/` owns local diagnostics output only; it must not upload data.

## Interactive Application Flow

Running without arguments must run the complete guided flow:

1. Discover Claude and Codex history sources.
2. Show source diagnostics and extraction counts.
3. Extract user prompts only.
4. Normalize prompts.
5. Cluster prompts locally.
6. Rank repeated workflow candidates.
7. Remove candidates already covered by existing project-local or global skills.
8. Present candidates interactively.
9. Let the user inspect, merge, rename, approve, or reject candidates.
10. Recommend project-local or global scope.
11. Ask the user to choose scope.
12. Ask the user to choose Claude, Codex/agents, or both.
13. Launch the selected local agent with the embedded generation template.
14. The agent writes one `SKILL.md` directly to the first selected target.
15. Validate the written skill.
16. Mirror the same `SKILL.md` to any additional selected targets.

All runtime decisions must be interactive prompts.

## Prompt Dump Flow

Running `ritual prompts` or `ritual --prompts` must:

1. Discover the same default Claude and Codex history sources as the interactive flow.
2. Extract user prompts only.
3. Sort prompts by `createdAt` descending, with undated prompts last.
4. Write at most 100 prompts by default.
5. Accept `--limit N` or `-n N` to override the prompt count.
6. Format each line as tab-separated `createdAt`, source, and prompt text fields.

The command must not cluster prompts, launch an agent, or write skill files.

## TypeScript Standards

TypeScript must run at maximum practical strictness from day one.

Required `tsconfig.json` posture:

- `strict: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- `noImplicitOverride: true`
- `noImplicitReturns: true`
- `noFallthroughCasesInSwitch: true`
- `noPropertyAccessFromIndexSignature: true`
- `useUnknownInCatchVariables: true`
- `isolatedModules: true`
- `verbatimModuleSyntax: true`
- `forceConsistentCasingInFileNames: true`
- `skipLibCheck: false`

Coding rules:

- Prefer `unknown` plus explicit narrowing over `any`.
- Model parsed history records with discriminated unions.
- Treat filesystem and subprocess results as untrusted input.
- Keep parser functions total: malformed records return diagnostics instead of throwing through the scan.
- Keep side effects behind wrapper modules.
- Avoid global mutable state outside the interactive session controller.

## Biome Standards

Biome is the formatter and linter. The project must not add ESLint or Prettier.

Required quality gate:

```bash
biome check .
```

The Biome configuration should enforce:

- formatting checks in CI
- lint checks in CI
- import organization
- no unused imports
- no unused variables
- no implicit `any` escape hatches
- no unsafe suppression comments without a reason

Suppression comments are allowed only when they include a specific reason and the alternative is worse for correctness or user safety.

## Quality Gates

The repository must expose one aggregate verification command for local and CI use.

Required package scripts:

```json
{
  "scripts": {
    "check": "biome check .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "build": "tsc -p tsconfig.build.json",
    "verify": "bun run check && bun run typecheck && bun run test && bun run build"
  }
}
```

Required gate before merge:

```bash
bun run verify
```

Quality gates must fail on formatting, lint, type, test, or build errors. CI must use the same commands as local development.

## Testing Strategy

Tests should scale with the risk of the CLI writing files into user skill roots.

Required unit coverage:

- Claude history parser fixtures.
- Codex history parser fixtures.
- Prompt normalization.
- Local clustering and ranking.
- Scope recommendation.
- Skill name sanitization.
- Target path resolution.
- `SKILL.md` validation.
- Overwrite protection.

Required integration coverage:

- End-to-end dry session using fixture history.
- Partial source failure with successful continuation.
- No strong candidates path.
- Near-miss threshold lowering.
- Existing skill suppresses a matching repeated workflow candidate.
- Direct write to project-local Claude target.
- Direct write to project-local Codex/agents target.
- Mirroring the direct write to both targets.

Tests must not read the developer's real Claude or Codex history. Use fixtures and temporary directories only.

## History Parsing

History parsing must be privacy-preserving and resilient.

Requirements:

- Discover Claude and Codex history locations independently.
- Extract user prompts only.
- Preserve original prompt text for review.
- Preserve source metadata needed for diagnostics.
- Continue after malformed files or records.
- Report unsupported formats clearly.
- Never upload history during discovery, extraction, clustering, or ranking.

Parser output should use a shared internal shape:

```ts
type ExtractedPrompt = {
  id: string;
  source: "claude" | "codex";
  sourcePath: string;
  sessionId?: string;
  createdAt?: string;
  text: string;
};
```

## Clustering And Ranking

MVP clustering must be local-only.

Recommended approach:

- Normalize whitespace and casing for comparison.
- Tokenize prompt text.
- Remove low-signal stop words conservatively.
- Compute lexical similarity.
- Group prompts above a similarity threshold.
- Score clusters by recurrence count and coherence.
- Default strong-candidate threshold to 3 prompts.
- Let the user lower the threshold to 2 interactively when results are sparse.

The implementation must keep original prompt text separate from normalized comparison text.

## Skill Drafting

Skill drafting uses a local agent executable only after the user approves a candidate.

Supported drafting executables:

- `claude`
- `codex`

Ritual launches the selected executable as an inherited terminal session and passes the generated drafting prompt as the final argv argument. Claude launches with `--dangerously-skip-permissions`; Codex launches with `--yolo`. The prompt tells the agent to write the first selected final skill target, and Ritual validates that file after the agent exits.

The drafting prompt must come from an embedded, versioned template derived from `skill-creator`. Runtime behavior must not depend on the user's installed `skill-creator` files.

The template must require:

- one `SKILL.md`
- frontmatter containing only `name` and `description`
- lowercase hyphen-case skill name
- trigger-rich description
- concise actionable body
- imperative or infinitive instruction style
- no unrelated auxiliary docs
- no ecosystem-specific metadata files in the MVP

The generated skill should be production-quality, not a stub. If the selected prompt cluster is too vague to draft a strong skill, Ritual should warn the user and offer to return to candidate selection.

## Direct Skill Write

Ritual does not create a temporary draft workspace in the streamlined flow.

Rules:

- Resolve selected target paths before launching the agent.
- Ask for confirmation only when a selected target already exists.
- Tell the launched agent to write the first selected target path directly.
- Validate from that written target directory.
- Copy the validated content to any additional selected target paths.
- Do not store extracted history in the draft file unless the user explicitly keeps provenance.

## Validation

Validation must separate blocking structural failures from quality warnings.

Blocking failures:

- Missing `SKILL.md`.
- Invalid YAML frontmatter.
- Frontmatter fields other than `name` and `description`.
- Missing `name`.
- Missing `description`.
- Non-hyphen-case skill name.
- Empty body.
- Placeholder body.
- Weak trigger description.

Warnings:

- Body is too generic.
- Body lacks concrete workflow steps.
- Body repeats obvious model capabilities.
- Body mentions bundled resources but no resource files exist.
- Body is longer than the configured threshold.

Use `agnix` when available. Built-in validation is required and must be sufficient for MVP operation when `agnix` is unavailable.

## Filesystem Safety

Ritual writes files into user-controlled directories, so filesystem behavior must be defensive.

Requirements:

- Resolve all target paths before writing.
- Sanitize skill names before path construction.
- Create parent directories only after user approval.
- Never overwrite an existing skill without interactive confirmation.
- Use atomic writes where practical.
- Keep final writes idempotent after validation.
- Treat global skill writes as an explicit scope choice; ask again only when an existing skill would be overwritten.

## Release And Publishing

Ritual is published to npm and must be runnable with `bunx ritualai@latest`.

Release requirements:

- Use SemVer.
- Keep `CHANGELOG.md` as the canonical human-readable release history.
- Automate publishing through GitHub Actions on `v*` tag push.
- Run `bun install --frozen-lockfile`.
- Run `bun run verify`.
- Build the package.
- Publish to the npm registry only after all gates pass.
- Use `bun publish` with `NPM_TOKEN` for the initial release workflow.
- Track npm trusted publishing/provenance as a future hardening step if Bun supports the required workflow.
- Create or update a GitHub Release from the tag.

The release workflow must not publish on ordinary branch pushes.

## GitHub Actions

Required workflows:

- CI workflow for pull requests and default branch pushes.
- Release workflow for `v*` tag pushes.

CI workflow gates:

- install dependencies with `bun install --frozen-lockfile`
- run `bun run verify`

Release workflow gates:

- trigger only on `push` tags matching `v*`
- install dependencies with `bun install --frozen-lockfile`
- run `bun run verify`
- publish to the npm registry with `bun publish`
- generate GitHub Release notes from `CHANGELOG.md` or tag contents

Workflow permissions should use least privilege. Release publishing should use `contents: write` only for GitHub Release creation and should not request `id-token: write` unless trusted publishing/provenance is added later.

## Production Readiness

Ritual must be production-grade from day one.

Required before first public release:

- Strict TypeScript enabled.
- Biome check enforced locally and in CI.
- Typecheck enforced locally and in CI.
- Unit and integration tests for all write paths.
- Build verified in CI.
- Bun package contents audited with `bun pm pack --dry-run`.
- No real history files used in tests.
- Clear errors for missing Claude, Codex, editor, or drafting executables.
- Clear diagnostics for unsupported history formats.
- Changelog updated before tagging.
- Release workflow tested without publishing where possible.

## Open Questions

- Which Node.js LTS major should be the minimum supported runtime?
- Which prompt library should own interactive UI rendering?
- Should local clustering use a hand-rolled lexical algorithm or a small dependency?
- Should release notes be generated directly from `CHANGELOG.md` sections or maintained separately in GitHub Releases?
- Should npm trusted publishing be added after Bun supports the required provenance workflow?
