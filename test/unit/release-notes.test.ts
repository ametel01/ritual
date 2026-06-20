import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const scriptPath = fileURLToPath(
  new URL("../../scripts/extract-release-notes.mjs", import.meta.url),
);
const execFileAsync = promisify(execFile);

describe("release note extraction", () => {
  async function mktempChangelog(content: string): Promise<string> {
    const tempDir = await mkdtemp(path.join(tmpdir(), "ritual-changelog-"));
    const changelogPath = path.join(tempDir, "CHANGELOG.md");
    await writeFile(changelogPath, content, "utf8");
    return changelogPath;
  }

  async function extract(
    version: string,
    changelogPath: string,
  ): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync("node", [scriptPath, version, changelogPath], {
      encoding: "utf8",
    });
  }

  it("extracts the requested section and stops before the next heading", async () => {
    const changelogPath = await mktempChangelog(
      [
        "# Changelog",
        "",
        "## [1.2.3] - 2026-06-20",
        "",
        "- Added release note extraction coverage.",
        "- Improved diagnostics in history discovery.",
        "",
        "## [1.2.2] - 2026-06-19",
        "- Earlier notes.",
        "",
      ].join("\n"),
    );

    const result = await extract("1.2.3", changelogPath);

    expect(result.stdout.trim()).toBe(
      "- Added release note extraction coverage.\n- Improved diagnostics in history discovery.",
    );
  });

  it("accepts a version argument prefixed with v", async () => {
    const changelogPath = await mktempChangelog(
      [
        "# Changelog",
        "",
        "## [1.2.3] - 2026-06-20",
        "",
        "- Added release note extraction coverage.",
        "",
      ].join("\n"),
    );

    const result = await extract("v1.2.3", changelogPath);

    expect(result.stdout.trim()).toBe("- Added release note extraction coverage.");
  });

  it("fails with an actionable message when the requested section is missing", async () => {
    const changelogPath = await mktempChangelog(
      ["# Changelog", "", "## [1.2.2] - 2026-06-19", "- Existing notes."].join("\n"),
    );

    await expect(extract("1.2.3", changelogPath)).rejects.toMatchObject({
      code: 1,
      stderr: "No changelog section found for version 1.2.3.\n",
    });
  });

  it("fails when the matching section is empty", async () => {
    const changelogPath = await mktempChangelog(
      [
        "# Changelog",
        "",
        "## [1.2.3] - 2026-06-20",
        "",
        "## [1.2.2] - 2026-06-19",
        "- Existing notes.",
      ].join("\n"),
    );

    await expect(extract("1.2.3", changelogPath)).rejects.toMatchObject({
      code: 1,
      stderr: "Changelog section for version 1.2.3 is empty.\n",
    });
  });
});
