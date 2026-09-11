import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSkillsFromDir, type Skill } from "@earendil-works/pi-coding-agent";

const defaultRoot = (): string => {
  const base = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(base, "../programs/skills"),
    path.resolve(base, "../../programs/skills"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]!;
};

/** Load immutable Skills used only by built-in Programs and exact agent binding. */
export const loadBuiltinProgramSkills = (root = defaultRoot()): Skill[] => {
  const loaded = loadSkillsFromDir({ dir: root, source: "pi-fabric:builtin-program" });
  if (loaded.diagnostics.length > 0) {
    const reasons = loaded.diagnostics.map((diagnostic) => diagnostic.message).join("; ");
    throw new Error(`Invalid built-in Program Skills: ${reasons}`);
  }
  return loaded.skills;
};
