import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { discoverHistorySources, scanHistorySources } from "../../src/history/discover.js";
import { parseClaudeHistoryFile } from "../../src/history/parse-claude.js";
import { parseCodexHistoryFile } from "../../src/history/parse-codex.js";

describe("history parsers", () => {
  it("extracts only user prompts from Claude JSONL records", () => {
    const result = parseClaudeHistoryFile(
      "/tmp/claude.jsonl",
      [
        JSON.stringify({ type: "user", message: { role: "user", content: "write tests" } }),
        JSON.stringify({ type: "assistant", message: { role: "assistant", content: "ok" } }),
        JSON.stringify({
          type: "user",
          message: { role: "user", content: [{ type: "text", text: "fix lint" }] },
        }),
      ].join("\n"),
    );

    expect(result.prompts.map((prompt) => prompt.text)).toEqual(["write tests", "fix lint"]);
    expect(result.prompts.every((prompt) => prompt.source === "claude")).toBe(true);
  });

  it("extracts user prompts from Claude prompt history records", () => {
    const result = parseClaudeHistoryFile(
      "/tmp/history.jsonl",
      [
        JSON.stringify({
          display: "document this recurring workflow",
          timestamp: 1775423768000,
          project: "/tmp/project",
          sessionId: "74a98bac-3604-4ecf-8a45-44d55b540725",
        }),
      ].join("\n"),
    );

    expect(result.prompts).toHaveLength(1);
    expect(result.prompts[0]).toMatchObject({
      source: "claude",
      sourcePath: "/tmp/history.jsonl",
      sessionId: "74a98bac-3604-4ecf-8a45-44d55b540725",
      createdAt: "2026-04-05T21:16:08.000Z",
      text: "document this recurring workflow",
    });
    expect(result.diagnostics).toEqual([]);
  });

  it("extracts only user prompts from Codex records and reports malformed lines", () => {
    const result = parseCodexHistoryFile(
      "/tmp/codex.jsonl",
      [
        JSON.stringify({ role: "user", content: [{ type: "input_text", text: "review this" }] }),
        JSON.stringify({ role: "assistant", content: "not included" }),
        "not-json",
      ].join("\n"),
    );

    expect(result.prompts).toHaveLength(1);
    expect(result.prompts[0]?.text).toBe("review this");
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes("Malformed"))).toBe(
      true,
    );
  });

  it("ignores slash commands and skill call records", () => {
    const result = parseCodexHistoryFile(
      "/tmp/codex.jsonl",
      [
        JSON.stringify({ role: "user", content: [{ type: "input_text", text: "/status" }] }),
        JSON.stringify({
          role: "user",
          content: [{ type: "input_text", text: "<skill>\nignored\n</skill>" }],
        }),
        JSON.stringify({
          role: "user",
          content: [{ type: "input_text", text: "$commit-all-changes-logically" }],
        }),
        JSON.stringify({
          role: "user",
          content: [{ type: "input_text", text: "[$improve](/tmp/improve/SKILL.md)" }],
        }),
        JSON.stringify({
          role: "user",
          content: [
            {
              type: "input_text",
              text: "prepare for release v0.5.2 and [$commit-all-changes-logically](/tmp/SKILL.md)",
            },
          ],
        }),
        JSON.stringify({ role: "user", content: [{ type: "input_text", text: "review this" }] }),
      ].join("\n"),
    );

    expect(result.prompts.map((prompt) => prompt.text)).toEqual(["review this"]);
  });

  it("ignores low-signal acknowledgements but keeps substantive short prompts", () => {
    const result = parseCodexHistoryFile(
      "/tmp/codex.jsonl",
      [
        JSON.stringify({ role: "user", content: [{ type: "input_text", text: "agree" }] }),
        JSON.stringify({
          role: "user",
          content: [{ type: "input_text", text: "agree with your suggestion" }],
        }),
        JSON.stringify({
          role: "user",
          content: [{ type: "input_text", text: "agree with your proposal" }],
        }),
        JSON.stringify({
          role: "user",
          content: [{ type: "input_text", text: "agree with your recommendation" }],
        }),
        JSON.stringify({
          role: "user",
          content: [{ type: "input_text", text: "proceed with your recommendation" }],
        }),
        JSON.stringify({ role: "user", content: [{ type: "input_text", text: "no" }] }),
        JSON.stringify({ role: "user", content: [{ type: "input_text", text: "fix it" }] }),
        JSON.stringify({
          role: "user",
          content: [{ type: "input_text", text: "agree, implement it" }],
        }),
        JSON.stringify({
          role: "user",
          content: [{ type: "input_text", text: "agree, keep it experimental" }],
        }),
        JSON.stringify({ role: "user", content: [{ type: "input_text", text: "resume" }] }),
        JSON.stringify({ role: "user", content: [{ type: "input_text", text: "clear" }] }),
        JSON.stringify({ role: "user", content: [{ type: "input_text", text: "commit" }] }),
        JSON.stringify({
          role: "user",
          content: [
            {
              type: "input_text",
              text: "ok all deployed how can we test SEO effectiveness?",
            },
          ],
        }),
      ].join("\n"),
    );

    expect(result.prompts.map((prompt) => prompt.text)).toEqual([
      "commit",
      "ok all deployed how can we test SEO effectiveness?",
    ]);
  });

  it("ignores structured payloads, terminal transcripts, attachments, and generated handoffs", () => {
    const result = parseCodexHistoryFile(
      "/tmp/codex.jsonl",
      [
        JSON.stringify({
          role: "user",
          content: [{ type: "input_text", text: '{"system":"strict analyst","prompt":"score"}' }],
        }),
        JSON.stringify({
          role: "user",
          content: [
            {
              type: "input_text",
              text: "alexmetelli@Alexs-MacBook-Pro aztec-rs % AZTEC_NODE_URL=http://localhost:8545 yarn test",
            },
          ],
        }),
        JSON.stringify({
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Last login: Wed Apr 15 06:13:25 on ttys009 alexmetelli@Alexs-MacBook-Pro repo %",
            },
          ],
        }),
        JSON.stringify({
          role: "user",
          content: [
            {
              type: "input_text",
              text: '<image name=[Image #1] path="/tmp/Screenshot.png">',
            },
          ],
        }),
        JSON.stringify({
          role: "user",
          content: [
            {
              type: "input_text",
              text: '"/Users/alexmetelli/source/app/Screenshot 2026-06-09 at 3.21.59.png"',
            },
          ],
        }),
        JSON.stringify({
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Repository: /Users/alexmetelli/source/open-maintainer. Read-only design task.",
            },
          ],
        }),
        JSON.stringify({
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Fix the selected Agent Skills findings in this repository. Project root: /tmp/project",
            },
          ],
        }),
        JSON.stringify({
          role: "user",
          content: [{ type: "input_text", text: "review this branch for release blockers" }],
        }),
      ].join("\n"),
    );

    expect(result.prompts.map((prompt) => prompt.text)).toEqual([
      "review this branch for release blockers",
    ]);
  });

  it("ignores local page checks, rendered output, logs, risk reports, and ci dumps", () => {
    const result = parseCodexHistoryFile(
      "/tmp/codex.jsonl",
      [
        JSON.stringify({
          role: "user",
          content: [
            {
              type: "input_text",
              text: "now check this page http://localhost:4321/blog content. is it all accurate?",
            },
          ],
        }),
        JSON.stringify({
          role: "user",
          content: [
            {
              type: "input_text",
              text: "┌ CleanMyJunk Dashboard width=100 color NAV ▸ Smart Care Cleanup Protection",
            },
          ],
        }),
        JSON.stringify({
          role: "user",
          content: [
            {
              type: "input_text",
              text: "2026-04-24T06:29:15+08:00 ERROR [crates/gpui/src/window.rs:1273] window not found",
            },
          ],
        }),
        JSON.stringify({
          role: "user",
          content: [
            {
              type: "input_text",
              text: "i still have all this ## Risk Reasons - high `risky_command`: Risky command detected",
            },
          ],
        }),
        JSON.stringify({
          role: "user",
          content: [
            {
              type: "input_text",
              text: "why the ci is failing Prepare all required actions Getting action download info",
            },
          ],
        }),
        JSON.stringify({
          role: "user",
          content: [{ type: "input_text", text: "investigate ci failure from latest logs" }],
        }),
      ].join("\n"),
    );

    expect(result.prompts.map((prompt) => prompt.text)).toEqual([
      "investigate ci failure from latest logs",
    ]);
  });

  it("ignores injected runtime event records", () => {
    const result = parseCodexHistoryFile(
      "/tmp/codex.jsonl",
      [
        JSON.stringify({
          role: "user",
          content: [
            {
              type: "input_text",
              text: "<turn_aborted> The user interrupted the previous turn on purpose. </turn_aborted>",
            },
          ],
        }),
        JSON.stringify({
          role: "user",
          content: [
            {
              type: "input_text",
              text: '<subagent_notification> {"agent_path":"019df704-d0d3-7b22-b69d-f8c59f767b"} </subagent_notification>',
            },
          ],
        }),
        JSON.stringify({ role: "user", content: [{ type: "input_text", text: "continue plan" }] }),
      ].join("\n"),
    );

    expect(result.prompts.map((prompt) => prompt.text)).toEqual(["continue plan"]);
  });

  it("ignores assistant completion summaries captured in prompt history", () => {
    const result = parseCodexHistoryFile(
      "/tmp/history.jsonl",
      [
        JSON.stringify({
          session_id: "assistant-1",
          ts: 1775423768,
          text: "Committed and pushed: abc123 docs(cli): align behavior\n\nVerification passed:\n- test",
        }),
        JSON.stringify({
          session_id: "assistant-2",
          ts: 1775423769,
          text: "Implemented the concrete fixes.\n\nChanged:\n- Updated parser.\n\nValidation:\n- tests passed",
        }),
        JSON.stringify({
          session_id: "user",
          ts: 1775423770,
          text: "in the pr opened from this branch i found issues, fix them",
        }),
      ].join("\n"),
    );

    expect(result.prompts.map((prompt) => prompt.text)).toEqual([
      "in the pr opened from this branch i found issues, fix them",
    ]);
  });

  it("ignores assistant review reports captured in prompt history", () => {
    const result = parseCodexHistoryFile(
      "/tmp/history.jsonl",
      [
        JSON.stringify({
          session_id: "user-commit",
          ts: 1775423768,
          text: "commit",
        }),
        JSON.stringify({
          session_id: "assistant-review",
          ts: 1775423769,
          text: [
            "i found some issue in the current diffs - High posthog/source.py:103 only fixes schema inference.",
            "Notes The local branch diff is clean and narrow.",
            "Verification run:",
            "- pytest passed",
            "Direct schema repro still fails.",
          ].join(" "),
        }),
        JSON.stringify({
          session_id: "user-review",
          ts: 1775423770,
          text: "in this branch we are trying to fix this issue review the diffs against main and find bugs",
        }),
      ].join("\n"),
    );

    expect(result.prompts.map((prompt) => prompt.text)).toEqual([
      "commit",
      "in this branch we are trying to fix this issue review the diffs against main and find bugs",
    ]);
  });

  it("extracts user prompts from Codex response_item payload envelopes", () => {
    const result = parseCodexHistoryFile(
      "/tmp/codex-real.jsonl",
      [
        JSON.stringify({
          timestamp: "2026-06-14T17:43:53.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "developer",
            content: [
              { type: "input_text", text: "<skills_instructions>internal</skills_instructions>" },
            ],
          },
        }),
        JSON.stringify({
          timestamp: "2026-06-14T17:43:54.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: "# AGENTS.md instructions for /tmp/project\n<INSTRUCTIONS>internal</INSTRUCTIONS>",
              },
              {
                type: "input_text",
                text: "# AGENTS.md instructions\n\n<INSTRUCTIONS>internal</INSTRUCTIONS>",
              },
              {
                type: "input_text",
                text: "<environment_context><cwd>/tmp/project</cwd></environment_context>",
              },
            ],
          },
        }),
        JSON.stringify({
          timestamp: "2026-06-14T17:43:55.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: "Generate a file named AGENTS.md that serves as a contributor guide for this repository.",
              },
            ],
          },
        }),
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "not included" }],
          },
        }),
      ].join("\n"),
    );

    expect(result.prompts.map((prompt) => prompt.text)).toEqual([
      "Generate a file named AGENTS.md that serves as a contributor guide for this repository.",
    ]);
    expect(result.prompts[0]?.createdAt).toBe("2026-06-14T17:43:55.000Z");
    expect(result.diagnostics).toEqual([]);
  });

  it("extracts user prompts from Codex prompt history records", () => {
    const result = parseCodexHistoryFile(
      "/tmp/history.jsonl",
      [
        JSON.stringify({
          session_id: "019ec913-36c7-7363-8901-6286791eef1b",
          ts: 1775423768,
          text: "review this codebase for repeated workflows",
        }),
      ].join("\n"),
    );

    expect(result.prompts).toHaveLength(1);
    expect(result.prompts[0]).toMatchObject({
      source: "codex",
      sourcePath: "/tmp/history.jsonl",
      sessionId: "019ec913-36c7-7363-8901-6286791eef1b",
      createdAt: "2026-04-05T21:16:08.000Z",
      text: "review this codebase for repeated workflows",
    });
    expect(result.diagnostics).toEqual([]);
  });
});

describe("history discovery", () => {
  it("uses Claude prompt history and project transcripts as default Claude sources", async () => {
    const homeDir = await mkdtempInTest("ritual-history-home-");
    await mkdir(path.join(homeDir, ".claude", "projects", "-tmp-project"), {
      recursive: true,
    });
    await writeFile(path.join(homeDir, ".claude", "history.jsonl"), "", "utf8");
    await writeFile(
      path.join(homeDir, ".claude", "projects", "-tmp-project", "session.jsonl"),
      "",
      "utf8",
    );

    const result = await discoverHistorySources({ cwd: "/tmp/project", homeDir });

    expect(result.sources).toEqual([
      { kind: "claude", path: path.join(homeDir, ".claude", "history.jsonl") },
      {
        kind: "claude",
        path: path.join(homeDir, ".claude", "projects", "-tmp-project", "session.jsonl"),
      },
    ]);
  });

  it("honors CLAUDE_CONFIG_DIR when discovering Claude history", async () => {
    const homeDir = await mkdtempInTest("ritual-history-home-");
    const claudeConfigDir = path.join(homeDir, ".claude-work");
    await mkdir(claudeConfigDir, { recursive: true });
    await writeFile(path.join(homeDir, ".claude", "history.jsonl"), "", "utf8").catch(() => {});
    await writeFile(path.join(claudeConfigDir, "history.jsonl"), "", "utf8");

    const result = await discoverHistorySources({
      cwd: "/tmp/project",
      homeDir,
      env: { CLAUDE_CONFIG_DIR: claudeConfigDir },
    });

    expect(result.sources).toEqual([
      { kind: "claude", path: path.join(claudeConfigDir, "history.jsonl") },
    ]);
  });

  it("uses Codex prompt history and session transcripts as default Codex sources", async () => {
    const homeDir = await mkdtempInTest("ritual-history-home-");
    await mkdir(path.join(homeDir, ".codex", "sessions", "2026", "06", "15"), {
      recursive: true,
    });
    await writeFile(path.join(homeDir, ".codex", "history.jsonl"), "", "utf8");
    await writeFile(
      path.join(homeDir, ".codex", "sessions", "2026", "06", "15", "rollout.jsonl"),
      "",
      "utf8",
    );

    const result = await discoverHistorySources({ cwd: "/tmp/project", homeDir });

    expect(result.sources).toEqual([
      { kind: "codex", path: path.join(homeDir, ".codex", "history.jsonl") },
      {
        kind: "codex",
        path: path.join(homeDir, ".codex", "sessions", "2026", "06", "15", "rollout.jsonl"),
      },
    ]);
  });

  it("uses Codex archived sessions and CODEX_HOME", async () => {
    const homeDir = await mkdtempInTest("ritual-history-home-");
    const codexHome = path.join(homeDir, ".codex-work");
    await mkdir(path.join(codexHome, "archived_sessions", "2026", "06", "15"), {
      recursive: true,
    });
    await writeFile(path.join(codexHome, "history.jsonl"), "", "utf8");
    await writeFile(
      path.join(codexHome, "archived_sessions", "2026", "06", "15", "rollout.jsonl"),
      "",
      "utf8",
    );

    const result = await discoverHistorySources({
      cwd: "/tmp/project",
      homeDir,
      env: { CODEX_HOME: codexHome },
    });

    expect(result.sources).toEqual([
      { kind: "codex", path: path.join(codexHome, "history.jsonl") },
      {
        kind: "codex",
        path: path.join(codexHome, "archived_sessions", "2026", "06", "15", "rollout.jsonl"),
      },
    ]);
  });
});

describe("history scanning", () => {
  it("deduplicates mirrored prompt history and transcript records", async () => {
    const homeDir = await mkdtempInTest("ritual-history-scan-");
    const historyPath = path.join(homeDir, "history.jsonl");
    const transcriptPath = path.join(homeDir, "session.jsonl");
    const text = "Review this PR for correctness bugs.";
    await writeFile(
      historyPath,
      JSON.stringify({
        session_id: "history",
        ts: 1775423768,
        text,
      }),
      "utf8",
    );
    await writeFile(
      transcriptPath,
      JSON.stringify({
        timestamp: "2026-04-05T21:16:08.871Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text }],
        },
      }),
      "utf8",
    );

    const result = await scanHistorySources([
      { kind: "codex", path: historyPath },
      { kind: "codex", path: transcriptPath },
    ]);

    expect(result.prompts.map((prompt) => prompt.createdAt)).toEqual(["2026-04-05T21:16:08.871Z"]);
    expect(result.sources.map((source) => source.prompts.length)).toEqual([0, 1]);
  });

  it("keeps repeated prompts outside the duplicate timestamp window", async () => {
    const homeDir = await mkdtempInTest("ritual-history-scan-");
    const historyPath = path.join(homeDir, "history.jsonl");
    const text = "Review this PR for correctness bugs.";
    await writeFile(
      historyPath,
      [
        JSON.stringify({ session_id: "first", ts: 1775423768, text }),
        JSON.stringify({ session_id: "second", ts: 1775423868, text }),
      ].join("\n"),
      "utf8",
    );

    const result = await scanHistorySources([{ kind: "codex", path: historyPath }]);

    expect(result.prompts.map((prompt) => prompt.sessionId)).toEqual(["first", "second"]);
  });
});

async function mkdtempInTest(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}
