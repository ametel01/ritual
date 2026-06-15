import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { buildSortedRuleGroups } from "../../src/diagnostics/grouping.js";
import type { Diagnostic } from "../../src/diagnostics/types.js";
import { writeDiagnosticsDirectory } from "../../src/diagnostics/write-results-directory.js";
import { buildHandoffPayload } from "../../src/prompts/build-handoff-payload.js";

function diagnostic(overrides: Partial<Diagnostic> = {}): Diagnostic {
  return {
    filePath: "src/App.tsx",
    plugin: "react-doctor",
    rule: "stable-props",
    severity: "error",
    title: "Avoid unstable props",
    message: "A component receives unstable props.",
    help: "Memoize the value or move it outside render.",
    line: 10,
    column: 3,
    category: "Performance",
    ...overrides,
  };
}

describe("diagnostic grouping", () => {
  it("preserves first-seen rule order without a priority map", () => {
    const groups = buildSortedRuleGroups([
      diagnostic({ plugin: "plugin-b", rule: "second" }),
      diagnostic({ plugin: "plugin-a", rule: "first" }),
      diagnostic({ plugin: "plugin-b", rule: "second", filePath: "src/Other.tsx" }),
    ]);

    expect(groups.map(([ruleKey]) => ruleKey)).toEqual(["plugin-b/second", "plugin-a/first"]);
    expect(groups[0]?.[1]).toHaveLength(2);
  });

  it("sorts prioritized rules ahead of unranked rules", () => {
    const groups = buildSortedRuleGroups(
      [
        diagnostic({ plugin: "plugin-b", rule: "second" }),
        diagnostic({ plugin: "plugin-a", rule: "first" }),
      ],
      new Map([["plugin-a/first", 100]]),
    );

    expect(groups.map(([ruleKey]) => ruleKey)).toEqual(["plugin-a/first", "plugin-b/second"]);
  });
});

describe("diagnostics directory", () => {
  it("writes diagnostics.json and one text dump per rule", async () => {
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "ritual-diagnostics-"));
    const directory = writeDiagnosticsDirectory(
      [
        diagnostic({ plugin: "react", rule: "memo" }),
        diagnostic({ plugin: "react", rule: "memo", filePath: "src/Card.tsx" }),
        diagnostic({ plugin: "a11y", rule: "button-name" }),
      ],
      outputDirectory,
    );

    await expect(readFile(path.join(directory, "diagnostics.json"), "utf8")).resolves.toContain(
      "button-name",
    );
    await expect(readdir(directory)).resolves.toEqual(
      expect.arrayContaining(["a11y--button-name.txt", "react--memo.txt"]),
    );
  });

  it("removes only rule dumps listed by the previous diagnostics file", async () => {
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "ritual-diagnostics-"));
    await writeFile(
      path.join(outputDirectory, "diagnostics.json"),
      JSON.stringify([diagnostic({ plugin: "old", rule: "rule" })]),
    );
    await writeFile(path.join(outputDirectory, "old--rule.txt"), "old");
    await writeFile(path.join(outputDirectory, "notes.txt"), "keep");

    writeDiagnosticsDirectory([diagnostic({ plugin: "new", rule: "rule" })], outputDirectory);

    await expect(readdir(outputDirectory)).resolves.toEqual(
      expect.arrayContaining(["diagnostics.json", "new--rule.txt", "notes.txt"]),
    );
    await expect(readdir(outputDirectory)).resolves.not.toContain("old--rule.txt");
  });
});

describe("handoff payload", () => {
  it("lists only the top three first-seen rule groups and references diagnostics.json", async () => {
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "ritual-handoff-"));
    const payload = buildHandoffPayload({
      projectName: "example-app",
      outputDirectory,
      diagnostics: [
        diagnostic({ plugin: "one", rule: "alpha", filePath: "src/A.tsx", title: "Alpha" }),
        diagnostic({ plugin: "two", rule: "beta", filePath: "src/B.tsx", title: "Beta" }),
        diagnostic({ plugin: "three", rule: "gamma", filePath: "src/C.tsx", title: "Gamma" }),
        diagnostic({ plugin: "four", rule: "delta", filePath: "src/D.tsx", title: "Delta" }),
      ],
    });

    expect(payload).toContain("Fix the top 3 React Doctor issues in example-app");
    expect(payload).toContain("Alpha (x1)");
    expect(payload).toContain("Beta (x1)");
    expect(payload).toContain("Gamma (x1)");
    expect(payload).not.toContain("Delta (x1)");
    expect(payload).toContain("diagnostics.json + a .txt per rule");
    await expect(
      readFile(path.join(outputDirectory, "diagnostics.json"), "utf8"),
    ).resolves.toContain("delta");
  });
});
