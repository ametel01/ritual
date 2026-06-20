# Plan 015: Make the CLI stdin lifecycle idempotent

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer dispatched you and told you they maintain
> the index.
>
> **Drift check (run first)**:
> `git diff --stat d5148d0..HEAD -- src/cli/runtime.ts test/unit/cli-runtime.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding. On a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `d5148d0`, 2026-06-21

## Why this matters

The CLI is normally a one-shot process, but the codebase also exposes `runCli`
for tests and programmatic use. Signal handlers were already made idempotent,
but stdin error handlers are still added on every `runCli` call. Repeated calls
with the same stdin can accumulate listeners, and the help path currently
unrefs stdin twice because it unrefs before returning and again in `finally`.

## Current state

- `src/cli/runtime.ts` owns CLI argument parsing, top-level error handling,
  signal handling, and stdin cleanup.
- `test/unit/cli-runtime.test.ts` has tests for help, prompt dump routing,
  signal handler idempotence, and cancellation.

Relevant excerpts:

```ts
// src/cli/runtime.ts:30
export async function runCli(options: RunCliOptions = {}): Promise<void> {
  installGracefulExitHandlers();
  const stdin = options.stdin ?? process.stdin;
  guardStdin(stdin);
```

```ts
// src/cli/runtime.ts:55
try {
  if (command.kind === "help") {
    output.stdout(formatHelp());
    unrefStdin(stdin);
    return;
  }
```

```ts
// src/cli/runtime.ts:78
} finally {
  unrefStdin(stdin);
}
```

```ts
// src/cli/runtime.ts:169
function guardStdin(stdin: RuntimeStdin): void {
  stdin.on("error", (error) => {
    if (isNodeError(error) && error.code === "EIO") {
      return;
    }
    throw error;
  });
}
```

Existing tests prove signal idempotence but not stdin listener idempotence:

```ts
// test/unit/cli-runtime.test.ts:229
it("installs SIGINT/SIGTERM handlers only once across repeated runCli calls", async () => {
```

The help test currently expects double unref:

```ts
// test/unit/cli-runtime.test.ts:86
expect(stdout).toContain(formatHelp());
expect(called).toEqual([]);
expect(exitCodes).toEqual([]);
expect(stdin.unrefCalls).toBe(2);
```

Repo conventions to match:

- Runtime tests use `FakeStdin extends EventEmitter`.
- Runtime tests inject `runInteractive`, `runPromptDump`, `output`, and
  `setExitCode` rather than invoking real CLI side effects.
- Use strict TypeScript; avoid `any`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `bun install --frozen-lockfile` | exit 0 |
| Focused tests | `bun run test -- test/unit/cli-runtime.test.ts` | exit 0, all CLI runtime tests pass |
| Typecheck | `bun run typecheck` | exit 0, no errors |
| Lint/format check | `bun run check` | exit 0, no diagnostics |
| Full gate | `bun run verify` | exit 0 |

## Scope

**In scope**:

- `src/cli/runtime.ts`
- `test/unit/cli-runtime.test.ts`
- `plans/README.md` status row update

**Out of scope**:

- Changing prompt rendering or `@inquirer/prompts` behavior.
- Changing signal handler semantics beyond preserving existing idempotence.
- Changing command parsing or help text content.
- Changing interactive session behavior.

## Git workflow

- Branch, if the operator wants one: `advisor/015-stdin-lifecycle-idempotent`.
- Commit message suggestion: `fix: make cli stdin guard idempotent`.
- Do not push or open a PR unless the operator instructs it.

## Steps

### Step 1: Add failing tests for stdin idempotence and single cleanup

In `test/unit/cli-runtime.test.ts`, update the help test to expect one unref
call instead of two.

Add a new test near the SIGINT/SIGTERM idempotence test:

- Create one `FakeStdin`.
- Call `runCli` twice with that same stdin and a stubbed interactive session.
- Assert `stdin.listenerCount("error")` increases by at most one from the
  baseline.
- Assert both runs still unref once per run.

Expected shape:

```ts
const baselineError = stdin.listenerCount("error");
await runCli({ stdin, ... });
await runCli({ stdin, ... });
expect(stdin.listenerCount("error") - baselineError).toBeLessThanOrEqual(1);
expect(stdin.unrefCalls).toBe(2);
```

**Verify**: `bun run test -- test/unit/cli-runtime.test.ts` should fail before
the runtime fix because the help test and/or duplicate listener test exposes the
current behavior.

### Step 2: Make stdin guarding idempotent

In `src/cli/runtime.ts`, add a module-level `WeakSet<RuntimeStdin>`:

```ts
const guardedStdin = new WeakSet<RuntimeStdin>();
```

Update `guardStdin`:

```ts
function guardStdin(stdin: RuntimeStdin): void {
  if (guardedStdin.has(stdin)) {
    return;
  }
  guardedStdin.add(stdin);
  stdin.on("error", (error) => {
    // existing handler body
  });
}
```

Keep the existing `EIO` behavior unchanged.

**Verify**: `bun run test -- test/unit/cli-runtime.test.ts` still fails only if
the help double-unref remains.

### Step 3: Remove the extra help-path unref

In the help branch inside the `try`, remove the direct `unrefStdin(stdin)` call.
The `finally` block should own cleanup for all successful command branches
inside the `try`.

Do not remove the `unrefStdin(stdin)` call in the parse-error branch before the
`try`; that branch returns before the `finally` exists.

**Verify**: `bun run test -- test/unit/cli-runtime.test.ts` exits 0.

### Step 4: Run the local quality gates

**Verify**:

- `bun run test -- test/unit/cli-runtime.test.ts` exits 0.
- `bun run typecheck` exits 0.
- `bun run check` exits 0.
- `bun run verify` exits 0.

## Test plan

- Update the existing help test to assert one cleanup call.
- Add a repeated-`runCli` test using one shared `FakeStdin`.
- Keep the existing SIGINT/SIGTERM idempotence test passing.

## Done criteria

- [ ] `guardStdin` is idempotent per stdin object.
- [ ] Help command cleanup runs once.
- [ ] Parse-error cleanup still runs.
- [ ] Signal handler idempotence remains covered.
- [ ] `bun run test -- test/unit/cli-runtime.test.ts` exits 0.
- [ ] `bun run typecheck` exits 0.
- [ ] `bun run check` exits 0.
- [ ] `bun run verify` exits 0.
- [ ] No files outside the in-scope list are modified except the optional status row in `plans/README.md`.

## STOP conditions

Stop and report back if:

- The runtime stdin abstraction changes and no longer supports object identity
  suitable for `WeakSet`.
- Fixing listener idempotence requires changing the public `RunCliOptions` API.
- A verification command fails twice after a reasonable fix attempt.

## Maintenance notes

If future runtime lifecycle hooks are added, keep ownership clear: setup should
be idempotent, and cleanup should happen exactly once per `runCli` invocation.
Tests should count listeners for any process-level or stream-level hooks that
can survive across repeated programmatic calls.
