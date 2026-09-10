import fs from "node:fs";
import type { Skill } from "@earendil-works/pi-coding-agent";
import { stripFrontmatter } from "@earendil-works/pi-coding-agent";

export interface ResolvedSkillBinding {
  /** Full prompt after native-equivalent Skill expansion. */
  task: string;
  /** Skill files supplied to Pi with default discovery disabled. */
  skillPaths: string[];
}

const skillBlock = (skill: Skill): string => {
  let content: string;
  try {
    content = fs.readFileSync(skill.filePath, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to activate required Skill ${skill.name}: ${reason}`);
  }
  const body = stripFrontmatter(content).trim();
  return `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
};

/**
 * Bind exact host-discovered Skills to one agent invocation.
 *
 * The supplied catalog is Pi's active, already-resolved catalog. Fabric neither
 * scans Skill locations nor retains activation beyond the returned invocation.
 */
export const resolveSkillBinding = (
  requested: readonly string[],
  installed: readonly Skill[],
  task: string,
): ResolvedSkillBinding => {
  const seen = new Set<string>();
  const selected: Skill[] = [];
  for (const rawName of requested) {
    if (typeof rawName !== "string" || rawName.trim().length === 0) {
      throw new Error("Invalid required Skill name: expected a non-empty string");
    }
    const name = rawName;
    if (seen.has(name)) {
      throw new Error(`Conflicting required Skill: ${name} is requested more than once`);
    }
    seen.add(name);
    const matches = installed.filter((skill) => skill.name === name);
    if (matches.length === 0) throw new Error(`Missing required Skill: ${name}`);
    if (matches.length > 1) {
      throw new Error(`Conflicting required Skill: ${name} resolves to multiple installed Skills`);
    }
    selected.push(matches[0]!);
  }

  const blocks = selected.map(skillBlock);
  return {
    task: blocks.length > 0 ? `${blocks.join("\n\n")}\n\n${task}` : task,
    skillPaths: selected.map((skill) => skill.filePath),
  };
};
