# Plan 013: Filter injected context at the final prompt boundary

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer dispatched you and told you they maintain
> the index.
>
> **Drift check (run first)**:
> `git diff --stat d5148d0..HEAD -- src/history/parse-shared.ts test/unit/history.test.ts docs/PRD.md docs/TECH_SPEC.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding. On a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `d5148d0`, 2026-06-21

## Why this matters

Ritual's value depends on extracting user-authored prompts while excluding
system, tool, metadata, and injected runtime context. The parser already filters
injected context when it appears inside array content parts, but the final
reusability filter does not reject injected context text. If Codex or Claude
stores injected context as plain string `content` or as prompt-history `text`,
`ritual prompts` and local fallback ranking can surface private runtime context
instead of real user prompts.

## Current state

- `src/history/parse-shared.ts` owns generic history record parsing and prompt
  filtering.
- `test/unit/history.test.ts` contains parser regression tests and should host
  the new coverage.
- `docs/PRD.md` and `docs/TECH_SPEC.md` define the privacy and prompt-extraction
  constraints this fix must preserve.

Relevant excerpts:

```ts
// src/history/parse-shared.ts:158
function contentToText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
```

```ts
// src/history/parse-shared.ts:184
function contentPartToText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return isInjectedContextText(value) ? undefined : value;
  }
```

```ts
// src/history/parse-shared.ts:202
function isInjectedContextText(text: string): boolean {
  const trimmed = text.trimStart();
  return (
    trimmed.startsWith("<codex_internal_context") ||
    trimmed.startsWith("<environment_context") ||
    trimmed.startsWith("<permissions instructions>") ||
    trimmed.startsWith("<collaboration_mode>") ||
    trimmed.startsWith("<apps_instructions>") ||
    trimmed.startsWith("<skills_instructions>") ||
    trimmed.startsWith("<plugins_instructions>") ||
    trimmed.startsWith("<turn_aborted>") ||
    trimmed.startsWith("<subagent_notification>") ||
    trimmed.startsWith("# AGENTS.md instructions")
  );
}
```

```ts
// src/history/parse-shared.ts:218
function isReusablePromptText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.startsWith("/")) {
    return false;
  }
  if (isSkillCallText(trimmed)) {
    return false;
  }
```

Existing coverage filters injected context when it appears as an array
`input_text` part:

```ts
// test/unit/history.test.ts:398
it("extracts user prompts from Codex response_item payload envelopes", () => {
  // ...
  text: "<environment_context><cwd>/tmp/project</cwd></environment_context>",
  // ...
  expect(result.prompts.map((prompt) => prompt.text)).toEqual([
    "Generate a file named AGENTS.md that serves as a contributor guide for this repository.",
  ]);
});
```

Documented constraints:

```md
<!-- docs/PRD.md:100 -->
### Prompt Extraction

- Extract user prompts only.
- Exclude assistant responses, tool outputs, system messages, and metadata unless needed for parsing.
```

```md
<!-- docs/TECH_SPEC.md:220 -->
History parsing must be privacy-preserving and resilient.
```

Repo conventions to match:

- Parser functions accept `unknown`, narrow explicitly, and return diagnostics
  rather than throwing.
- Tests construct JSON/JSONL fixture strings inline and assert extracted prompt
  text arrays.
- Use strict TypeScript and existing Biome formatting style: double quotes,
  semicolons, two-space indentation.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `bun install --frozen-lockfile` | exit 0 |
| Focused tests | `bun run test -- test/unit/history.test.ts` | exit 0, all history tests pass |
| Typecheck | `bun run typecheck` | exit 0, no errors |
| Lint/format check | `bun run check` | exit 0, no diagnostics |
| Full gate | `bun run verify` | exit 0 |

## Scope

**In scope**:

- `src/history/parse-shared.ts`
- `test/unit/history.test.ts`
- `plans/README.md` status row update

**Out of scope**:

- Changes to history discovery, file traversal, or file size limits.
- Changes to clustering thresholds or ranking behavior.
- Changes to the agent discovery handoff prompt.
- Adding new dependencies.

## Git workflow

- Branch, if the operator wants one: `advisor/013-filter-injected-context-boundary`.
- Commit message suggestion: `fix: filter injected context prompt text`.
- Do not push or open a PR unless the operator instructs it.

## Steps

### Step 1: Add regression coverage for direct-string injected context

In `test/unit/history.test.ts`, add coverage near the existing parser noise
filter tests. Add at least these cases:

- A Codex `response_item` payload with `role: "user"` and `content` as a plain
  string starting with `<environment_context...>`, followed by a real prompt.
- A Codex prompt-history record with `text` starting with
  `<skills_instructions...>`, followed by a real prompt-history record.
- Optional but useful: a Claude JSONL user record with `message.content` as a
  plain injected-context string, followed by a real prompt.

Expected assertion shape:

```ts
expect(result.prompts.map((prompt) => prompt.text)).toEqual(["review this parser change"]);
```

**Verify**: `bun run test -- test/unit/history.test.ts` should fail before the
fix because at least one injected-context string is still included.

### Step 2: Reject injected context in the final reusable-text filter

In `src/history/parse-shared.ts`, update `isReusablePromptText` so it rejects
`isInjectedContextText(trimmed)` immediately after the empty/slash-command
guard. The fix should be at the final candidate boundary so it protects
specialized prompt-history records as well as generic message records.

Target shape:

```ts
if (trimmed.length === 0 || trimmed.startsWith("/")) {
  return false;
}
if (isInjectedContextText(trimmed)) {
  return false;
}
```

Do not remove the existing `contentPartToText` filtering; it is still useful
because it prevents injected parts from being joined with legitimate text parts.

**Verify**: `bun run test -- test/unit/history.test.ts` exits 0.

### Step 3: Run the local quality gates for this parser change

Run the parser-specific test first, then the broader gates.

**Verify**:

- `bun run test -- test/unit/history.test.ts` exits 0.
- `bun run typecheck` exits 0.
- `bun run check` exits 0.
- `bun run verify` exits 0.

## Test plan

- New tests in `test/unit/history.test.ts` for injected context stored as plain
  string `content`.
- New tests in `test/unit/history.test.ts` for injected context stored as
  Codex prompt-history `text`.
- Existing tests around response item payloads, assistant responses, generated
  handoffs, and low-signal prompts must continue to pass.

## Done criteria

- [ ] `isReusablePromptText` rejects injected context text at the final boundary.
- [ ] Direct-string injected context does not appear in extracted prompts.
- [ ] Existing array-part filtering remains intact.
- [ ] `bun run test -- test/unit/history.test.ts` exits 0.
- [ ] `bun run typecheck` exits 0.
- [ ] `bun run check` exits 0.
- [ ] `bun run verify` exits 0.
- [ ] No files outside the in-scope list are modified except the optional status row in `plans/README.md`.

## STOP conditions

Stop and report back if:

- `src/history/parse-shared.ts` no longer contains `isReusablePromptText` or
  `isInjectedContextText`.
- The fix appears to require changing public `ExtractedPrompt` shape.
- Tests reveal that a legitimate user prompt beginning with one of the injected
  context markers must be preserved for product reasons.
- A verification command fails twice after a reasonable fix attempt.

## Maintenance notes

Future prompt filters should be added at the final `isReusablePromptText`
boundary unless they specifically need to alter how mixed content parts are
joined. Reviewer focus should be on avoiding over-filtering legitimate prompts
while preserving the product requirement to exclude system and runtime context.
