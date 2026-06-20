import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { latestPrompts, runPromptDump } from "../../src/cli/prompt-dump.js";
import type { ExtractedPrompt } from "../../src/history/types.js";

describe("prompt dump", () => {
  it("dumps the latest prompts in descending date order", async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), "ritual-prompt-dump-"));
    const codexHome = path.join(homeDir, ".codex");
    await mkdir(codexHome, { recursive: true });
    await writeFile(
      path.join(codexHome, "history.jsonl"),
      [
        JSON.stringify({ session_id: "older", ts: 1775423768, text: "older prompt" }),
        JSON.stringify({ session_id: "newest", ts: 1775423770, text: "newest prompt" }),
        JSON.stringify({ session_id: "middle", ts: 1775423769, text: "middle\nprompt" }),
      ].join("\n"),
      "utf8",
    );

    const lines: string[] = [];
    const result = await runPromptDump({
      cwd: "/tmp/project",
      homeDir,
      limit: 2,
      output: { write: (message) => lines.push(message) },
    });

    expect(result).toEqual({ status: "completed", count: 2 });
    expect(lines).toEqual([
      "2026-04-05T21:16:10.000Z\tcodex\tnewest prompt",
      "2026-04-05T21:16:09.000Z\tcodex\tmiddle prompt",
    ]);
  });

  it("sorts undated prompts after dated prompts", () => {
    const prompts: ExtractedPrompt[] = [
      { id: "undated", source: "codex", sourcePath: "/tmp/history.jsonl", text: "undated" },
      {
        id: "dated",
        source: "codex",
        sourcePath: "/tmp/history.jsonl",
        createdAt: "2026-01-01T00:00:00.000Z",
        text: "dated",
      },
    ];

    expect(latestPrompts(prompts).map((prompt) => prompt.id)).toEqual(["dated", "undated"]);
  });
});
