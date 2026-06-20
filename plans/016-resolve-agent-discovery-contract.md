# Plan 016: Resolve the agent discovery contract in the docs

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer dispatched you and told you they maintain
> the index.
>
> **Drift check (run first)**:
> `git diff --stat d5148d0..HEAD -- docs/PRD.md docs/TECH_SPEC.md src/cli/interactive.ts test/integration/session.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding. On a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `d5148d0`, 2026-06-21

## Why this matters

The product docs currently contain two different agent-discovery contracts. One
line says Ritual should parse structured agent findings back into the CLI, while
the current flow and technical spec describe a same-window handoff where the
selected agent presents the table and continues implementation itself. This
ambiguity makes future discovery work hard to plan: an executor could build a
parser that contradicts the shipped handoff model, or preserve the handoff while
leaving the PRD goal stale.

## Current state

- `docs/PRD.md` is the product requirements document.
- `docs/TECH_SPEC.md` is the implementation-oriented technical spec.
- `src/cli/interactive.ts` implements the current same-window handoff.
- `test/integration/session.test.ts` asserts the handoff result.

Conflicting or relevant excerpts:

```md
<!-- docs/PRD.md:37 -->
## Goals

- Scan local Claude and Codex history sources.
- Extract user prompts only.
- Let a user-selected local agent inspect discovered session/history paths for skill candidates.
- Parse structured agent findings back into the CLI.
```

```md
<!-- docs/PRD.md:72 -->
5. Ritual asks whether a local agent should inspect the discovered session/history paths for skill candidates.
6. The selected local agent opens in the terminal and reads those paths.
7. The agent presents a Markdown candidate table, gives an opinionated recommendation, and asks which skill or skills the user wants to implement.
8. The agent continues implementation in the same window after the user answers.
```

```md
<!-- docs/TECH_SPEC.md:81 -->
4. Ask whether to use a local agent to inspect the discovered session/history paths for skill candidates.
5. Launch the selected local agent as an inherited terminal session with discovery and implementation instructions.
6. Require the discovery agent to present a Markdown table, give an opinionated recommendation, and ask which skill or skills to implement in that same agent window.
```

```ts
// src/cli/interactive.ts:126
if (agentDiscovery.status === "handed-off") {
  return agentDiscovery;
}
```

```ts
// src/cli/interactive.ts:328
return { status: "handed-off", executable };
```

```ts
// test/integration/session.test.ts:147
expect(result).toEqual({ status: "handed-off", executable: "claude" });
```

Repo conventions to match:

- Product and technical docs are Markdown and use direct requirement bullets.
- The docs already distinguish Goals, MVP flow, Functional Requirements,
  Acceptance Criteria, and Open Questions.
- Do not invent new behavior in docs that code does not support.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `bun install --frozen-lockfile` | exit 0 |
| Search old contradiction | `rg -n "Parse structured agent findings back into the CLI" docs` | no matches, unless explicitly moved to a future/non-MVP section |
| Lint/format check | `bun run check` | exit 0, no diagnostics |
| Full gate | `bun run verify` | exit 0 |

## Scope

**In scope**:

- `docs/PRD.md`
- `docs/TECH_SPEC.md`
- `plans/README.md` status row update

**Out of scope**:

- Source code changes to `src/cli/interactive.ts`.
- Test changes.
- Implementing structured result parsing.
- Changing the agent discovery prompt or launch flags.

## Git workflow

- Branch, if the operator wants one: `advisor/016-agent-discovery-contract`.
- Commit message suggestion: `docs: align agent discovery contract`.
- Do not push or open a PR unless the operator instructs it.

## Steps

### Step 1: Choose and document the current MVP contract

Use the shipped behavior as the contract for now:

- Ritual asks the user whether to launch local agent discovery.
- Ritual launches the selected local agent with an analysis-and-implementation
  prompt.
- The agent presents a Markdown candidate table in the inherited terminal.
- The agent asks which skill or skills to implement.
- The agent continues in the same window after user approval.
- Ritual returns a `handed-off` result and does not parse the candidate table
  back into its own prompt UI in the MVP.

Update `docs/PRD.md` Goals so the stale parsing goal becomes either:

- a same-window structured Markdown findings goal, or
- an explicitly labeled future/post-MVP idea.

Do not leave it as an MVP goal unless you are also changing source code in a
separate implementation plan.

**Verify**: `rg -n "Parse structured agent findings back into the CLI" docs`
returns no matches, unless the phrase is clearly under a future/non-MVP heading.

### Step 2: Align functional requirements and acceptance criteria

Review the Agent Discovery and MVP Acceptance Criteria sections in
`docs/PRD.md`. Ensure they consistently describe the same-window handoff.

Keep these requirements intact:

- Agent discovery remains user-approved.
- The agent must not write files before the user approves an implementation
  choice.
- The agent must present suggested name, summary, rationale, confidence, scope,
  representative prompts, and source paths.
- Local clustering remains the fallback when discovery is declined, unavailable,
  or exits unsuccessfully.

**Verify**: `rg -n "agent.*same window|handed|structured|parse" docs/PRD.md`
shows no contradictory MVP requirements.

### Step 3: Align the technical spec with the chosen contract

Update `docs/TECH_SPEC.md` Agent Discovery with one explicit sentence:

```md
In the MVP, Ritual does not parse the discovery table back into its own prompt UI; after a successful agent discovery launch, the CLI reports a handoff and the selected agent owns the rest of the discovery/implementation conversation.
```

Use your own wording if clearer, but preserve that behavior.

**Verify**: `rg -n "does not parse|handed-off|handoff" docs/TECH_SPEC.md`
returns the new clarification.

### Step 4: Run documentation-safe gates

**Verify**:

- `bun run check` exits 0.
- `bun run verify` exits 0.

## Test plan

This is a docs-only alignment plan. No new automated tests are required unless
the executor chooses to adjust source behavior, which is out of scope.

Use these existing tests as behavioral anchors:

- `test/integration/session.test.ts` asserts `{ status: "handed-off", executable: "claude" }`.
- `test/unit/skills.test.ts` asserts the discovery prompt keeps implementation
  in the same selected agent window.

## Done criteria

- [ ] `docs/PRD.md` no longer presents structured parsing back into the CLI as an MVP requirement.
- [ ] `docs/TECH_SPEC.md` explicitly documents the same-window handoff contract.
- [ ] User approval and no-write-before-approval requirements remain documented.
- [ ] `rg -n "Parse structured agent findings back into the CLI" docs` returns no stale MVP match.
- [ ] `bun run check` exits 0.
- [ ] `bun run verify` exits 0.
- [ ] No files outside the in-scope list are modified except the optional status row in `plans/README.md`.

## STOP conditions

Stop and report back if:

- The maintainer wants structured parsing implemented now instead of documenting
  the current handoff. That is a source-code feature plan, not this docs plan.
- The PRD has already been changed to a new contract that differs from the
  excerpts above.
- A verification command fails twice after a reasonable fix attempt.

## Maintenance notes

If structured parsing becomes desirable later, write a new design/spike plan
that defines the report schema, where the report is stored, how private prompt
examples are redacted, and how the CLI resumes after the agent exits. Do not
bolt parsing onto the current handoff without first changing the documented
contract.
