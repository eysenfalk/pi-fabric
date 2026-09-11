import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { loadBuiltinProgramSkills } from "../src/programs/builtin-skills.js";

describe("built-in Program Skills", () => {
  it("loads the three private stage Skills from packaged resources", () => {
    const skills = loadBuiltinProgramSkills();
    expect(skills.map((skill) => skill.name).sort()).toEqual([
      "fabric-implement-change",
      "fabric-implement-plan",
      "fabric-implement-verify",
    ]);
    expect(skills.every((skill) => fs.existsSync(skill.filePath))).toBe(true);
  });

  it("keeps private Program Skills out of Pi's global package manifest", () => {
    const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
      pi: { skills: string[] };
    };
    expect(packageJson.pi.skills).toEqual([]);
  });
});
