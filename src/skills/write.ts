import * as path from "node:path";
import type { FileSystem } from "../system/filesystem.js";
import type { SkillTarget } from "./paths.js";

export async function writeFinalSkill(options: {
  targets: SkillTarget[];
  content: string;
  fs: FileSystem;
}): Promise<string[]> {
  const written: string[] = [];
  for (const target of options.targets) {
    await options.fs.ensureDir(path.dirname(target.skillPath));
    await options.fs.writeTextAtomic(target.skillPath, options.content);
    written.push(target.skillPath);
  }
  return written;
}
