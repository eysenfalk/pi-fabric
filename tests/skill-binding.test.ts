import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Skill } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentManager } from "../src/agents/manager.js";
import { resolveSkillBinding } from "../src/core/skill-binding.js";
import { DEFAULT_FABRIC_CONFIG } from "../src/config.js";
import { AGENTS_ACTION_DESCRIPTORS } from "../src/providers/agents-actions.js";
import { normalizeAgentRunRequest } from "../src/agents/request.js";
import type { AgentRunRequest } from "../src/agents/types.js";
import { ProcessTransport } from "../src/agents/transports/process-transport.js";
import { guestTypeDeclarations } from "../src/runtime/guest-types.js";
import { typeCheckFabricCode } from "../src/runtime/type-checker.js";

const roots: string[] = [];
const managers: AgentManager[] = [];
const temp = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-fabric-skill-binding-"));
  roots.push(root);
  return root;
};
const skill = (root: string, name: string, body: string): Skill => {
  const baseDir = path.join(root, name);
  const filePath = path.join(baseDir, "SKILL.md");
  fs.mkdirSync(baseDir, { recursive: true });
  fs.writeFileSync(filePath, `---\nname: ${name}\ndescription: ${name} guidance\n---\n\n${body}\n`);
  return {
    name,
    description: `${name} guidance`,
    filePath,
    baseDir,
    sourceInfo: { source: "test", scope: "project", origin: "path", path: filePath },
    disableModelInvocation: false,
  } as unknown as Skill;
};

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.close()));
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("resolveSkillBinding", () => {
  it("expands one real installed Skill using Pi's native block shape", () => {
    const root = temp();
    const planning = skill(root, "planning", "Plan deliberately.");
    expect(resolveSkillBinding(["planning"], [planning], "Design it")).toEqual({
      task: `<skill name="planning" location="${planning.filePath}">\nReferences are relative to ${planning.baseDir}.\n\nPlan deliberately.\n</skill>\n\nDesign it`,
      skillPaths: [planning.filePath],
    });
  });

  it("preserves requested multi-Skill order", () => {
    const root = temp();
    const first = skill(root, "first", "First guidance.");
    const second = skill(root, "second", "Second guidance.");
    const binding = resolveSkillBinding(["second", "first"], [first, second], "Work");
    expect(binding.skillPaths).toEqual([second.filePath, first.filePath]);
    expect(binding.task.indexOf("Second guidance.")).toBeLessThan(binding.task.indexOf("First guidance."));
  });

  it("fails explicitly for missing, duplicate-requested, conflicting-installed, and unreadable Skills", () => {
    const root = temp();
    const planning = skill(root, "planning", "Plan.");
    expect(() => resolveSkillBinding(["missing"], [planning], "Work")).toThrow("Missing required Skill: missing");
    expect(() => resolveSkillBinding(["planning", "planning"], [planning], "Work")).toThrow("Conflicting required Skill");
    expect(() => resolveSkillBinding(["planning"], [planning, { ...planning, filePath: `${planning.filePath}.other` }], "Work"))
      .toThrow("resolves to multiple installed Skills");
    fs.rmSync(planning.filePath);
    expect(() => resolveSkillBinding(["planning"], [planning], "Work")).toThrow("Failed to activate required Skill planning");
  });
});

describe("agent Skill binding contract", () => {
  it("publishes and types skills on run, spawn, handoff, workflow, council, and rlm calls", () => {
    for (const action of ["run", "spawn", "handoff"]) {
      const schema = AGENTS_ACTION_DESCRIPTORS.find((entry) => entry.name === action)!.inputSchema;
      const required = action === "handoff" ? { model: "test/model" } : { task: "work" };
      expect(Value.Check(schema, { ...required, skills: ["planning", "code-review"] })).toBe(true);
      expect(Value.Check(schema, { ...required, skills: [""] })).toBe(false);
    }
    const checked = typeCheckFabricCode(`
      await agents.run({ task: "a", skills: ["planning"] });
      await agents.spawn({ task: "b", skills: ["implementation"] });
      await agents.handoff({ model: "test/model", skills: ["debugging"] });
      await workflow.agent("c", { skills: ["code-review"] });
      await council.run({ task: "d", roles: ["reviewer"], skills: ["security-review"] });
      return rlm.query({ task: "e", skills: ["planning"] });
    `, guestTypeDeclarations(true));
    expect(checked.errors).toEqual([]);
    expect(normalizeAgentRunRequest({ task: "work", skills: [] }, { runner: "pi", timeoutMs: 0 }).skills).toEqual([]);
  });

  it("binds selected Skills through the real worker and isolates the next invocation", { timeout: 20_000 }, async () => {
    const root = temp();
    const planning = skill(root, "planning", "Plan with evidence.");
    const review = skill(root, "code-review", "Review the finished diff.");
    const fakePi = path.resolve("tests/fixtures/fake-pi-launch-probe.mjs");
    fs.chmodSync(fakePi, 0o755);
    const manager = new AgentManager(process.cwd(), DEFAULT_FABRIC_CONFIG.agents, {
      workerPath: path.resolve("src/worker.ts"),
      piBinary: fakePi,
      runRoot: path.join(root, "runs"),
      hostSkills: () => [planning, review],
    });
    managers.push(manager);

    const selected = await manager.run({
      task: "REPORT_LAUNCH_SURFACE",
      skills: ["code-review", "planning"],
      transport: "process",
      timeoutMs: 5_000,
    });
    const selectedSurface = JSON.parse(selected.text);
    expect(selectedSurface).toMatchObject({
      noSkills: true,
      skillPaths: [review.filePath, planning.filePath],
    });
    expect(selected.task.indexOf("Review the finished diff.")).toBeLessThan(selected.task.indexOf("Plan with evidence."));
    expect(selected.task).toMatch(/REPORT_LAUNCH_SURFACE$/);

    const ordinary = await manager.run({
      task: "REPORT_LAUNCH_SURFACE",
      transport: "process",
      timeoutMs: 5_000,
    });
    expect(JSON.parse(ordinary.text)).toMatchObject({ noSkills: false, skillPaths: [] });
    expect(ordinary.task).toBe("REPORT_LAUNCH_SURFACE");

    const none = await manager.run({
      task: "REPORT_LAUNCH_SURFACE",
      skills: [],
      transport: "process",
      timeoutMs: 5_000,
    });
    expect(JSON.parse(none.text)).toMatchObject({ noSkills: true, skillPaths: [] });
    expect(none.task).toBe("REPORT_LAUNCH_SURFACE");
  });

  it("rejects unresolved or unsupported bindings before model preparation and launch", async () => {
    const root = temp();
    const preparePiModel = vi.fn(async () => undefined);
    const launch = vi.spyOn(ProcessTransport.prototype, "launch");
    const manager = new AgentManager(process.cwd(), DEFAULT_FABRIC_CONFIG.agents, {
      workerPath: path.resolve("tests/fixtures/fake-worker.mjs"),
      runRoot: path.join(root, "runs"),
      preparePiModel,
      hostSkills: () => [],
    });
    managers.push(manager);

    await expect(manager.spawn({ task: "work", skills: ["missing"] })).rejects.toThrow("Missing required Skill: missing");
    await expect(manager.spawn({ task: "work", skills: [], runner: "claude" })).rejects.toThrow("only supported by the Pi runner");
    expect(preparePiModel).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
    expect(manager.list()).toEqual([]);
  });

  it("rejects malformed direct requests rather than silently dropping names", async () => {
    const manager = new AgentManager(process.cwd(), DEFAULT_FABRIC_CONFIG.agents, {
      workerPath: path.resolve("tests/fixtures/fake-worker.mjs"),
      runRoot: temp(),
      hostSkills: () => [],
    });
    managers.push(manager);
    await expect(manager.spawn({ task: "work", skills: [1] } as unknown as AgentRunRequest))
      .rejects.toThrow("Invalid required Skill name");
  });
});
