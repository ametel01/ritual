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
});
