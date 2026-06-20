import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { discoverHistorySources } from "../../src/history/discover.js";
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

async function mkdtempInTest(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}
