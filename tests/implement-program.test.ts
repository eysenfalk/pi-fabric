import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FABRIC_CONFIG } from "../src/config.js";
import { ActionRegistry } from "../src/core/action-registry.js";
import { FabricExecutionService } from "../src/execution-service.js";
import { InteractionsProvider } from "../src/providers/interactions-provider.js";
import type { FabricActionDescriptor, FabricInvocationContext } from "../src/protocol.js";

const registries: ActionRegistry[] = [];
afterEach(async () => {
  await Promise.all(registries.splice(0).map((registry) => registry.close()));
});

const agentDescriptor: FabricActionDescriptor = {
  name: "run",
  description: "Return deterministic child-agent fixture output",
  inputSchema: { type: "object", additionalProperties: true },
  risk: "agent",
};

const readyPlan = {
  needsInput: false,
  questions: [],
  intent: {
    outcome: "Add the requested public probe.",
    nonGoals: ["No unrelated refactor."],
    acceptance: ["The probe is observable."],
    risks: [],
  },
  repositoryFacts: [{ fact: "The public seam exists.", source: "src/probe.ts:1" }],
  track: "library",
  selectedSkills: ["repository-quality"],
  reviewRequired: false,
  implementationReason: "Reuse the existing public seam.",
  checks: [{ label: "Targeted behavior", reason: "Proves the public seam." }],
  rationale: "A small implementation and targeted check are sufficient.",
};
const ambiguousPlan = {
  ...structuredClone(readyPlan),
  needsInput: true,
  questions: [{
    id: "public-seam",
    prompt: "Which public seam should expose the probe?",
    reason: "The answer changes the observable contract.",
  }],
};
const implementation = {
  status: "completed",
  summary: "Implemented the probe.",
  changedFiles: ["src/probe.ts"],
  checksRun: ["probe test passed"],
  blockers: [],
  workflowChange: "",
};
const verification = {
  ok: true,
  summary: "Verified.",
  evidence: ["probe test passed"],
  failures: [],
  residualRisks: [],
};

const fixture = async (
  agentOutputs: unknown[],
  interactionOutputs: Array<{ status: "answered" | "cancelled"; value?: string }>,
  agentUsages: number[] = [],
) => {
  const registry = new ActionRegistry();
  registries.push(registry);
  const agentCalls: Array<Record<string, unknown>> = [];
  const interactionCalls: Array<Record<string, unknown>> = [];
  registry.register({
    name: "agents",
    description: "Agent fixture",
    async list() { return [agentDescriptor]; },
    async describe(name) { return name === "run" ? agentDescriptor : undefined; },
    async invoke(_name, args) {
      agentCalls.push(args);
      const value = agentOutputs.shift();
      if (value instanceof Error) throw value;
      return {
        status: "completed",
        value,
        usage: { input: agentUsages.shift() ?? 0, output: 0 },
      };
    },
  });
  const interactionDescriptor = await new InteractionsProvider().describe(
    "request",
    {} as FabricInvocationContext,
  );
  if (!interactionDescriptor) throw new Error("interactions.request descriptor missing");
  registry.register({
    name: "interactions",
    description: "Interaction fixture",
    async list() { return [interactionDescriptor]; },
    async describe(name) { return name === "request" ? interactionDescriptor : undefined; },
    async invoke(_name, args) {
      interactionCalls.push(args);
      return interactionOutputs.shift() ?? { status: "cancelled" };
    },
  });

  const config = structuredClone(DEFAULT_FABRIC_CONFIG);
  config.fullCodeMode = true;
  config.approvals.read = "allow";
  config.approvals.agent = "allow";
  const service = new FabricExecutionService(registry, config);
  const code = await readFile("programs/implement.ts", "utf8");
  const skills = [
    "fabric-implement-plan",
    "fabric-implement-change",
    "fabric-implement-verify",
    "repository-quality",
  ].map((name) => ({ name, description: `${name} description` }));
  const result = await service.execute({
    code,
    strings: {
      task: "Add a public probe",
      constraints: "Keep it small",
      sessionContext: "USER: Keep the API readable.",
      skillCatalog: JSON.stringify(skills),
    },
    signal: undefined,
    parentToolCallId: "implement-program-test",
    context: {
      cwd: process.cwd(),
      hasUI: true,
      mode: "tui",
      sessionManager: { getSessionId: () => "implement-program-test" },
    } as unknown as ExtensionContext,
    onPartial() {},
    maxAgentCalls: 10,
    tokenBudget: 100_000,
  });
  return { result, agentCalls, interactionCalls };
};

describe("builtin/implement Program", () => {
  it("renders Mermaid before approval, then binds exact per-stage Skills", async () => {
    const run = await fixture(
      [structuredClone(readyPlan), structuredClone(implementation), structuredClone(verification)],
      [{ status: "answered", value: "run" }],
    );

    if (!run.result.success) throw new Error(JSON.stringify(run.result, null, 2));
    expect(run.interactionCalls).toHaveLength(1);
    expect(run.interactionCalls[0]).toMatchObject({
      kind: "select",
      title: "Run this implementation workflow?",
      markdown: expect.stringContaining("```mermaid"),
    });
    expect(String(run.interactionCalls[0]?.markdown)).toContain("Understand ✓");
    expect(run.agentCalls.map((call) => call.skills)).toEqual([
      ["fabric-implement-plan"],
      ["fabric-implement-change", "repository-quality"],
      ["fabric-implement-verify"],
    ]);
    expect(run.agentCalls[0]?.tools).toEqual(["read", "grep", "find", "ls"]);
    expect(run.agentCalls[0]?.thinking).toBe("low");
    expect(run.agentCalls[1]?.tools).toContain("edit");
    expect(run.result.value).toContain("# Implementation completed");
    expect(run.result.value).toContain("```mermaid");
  });

  it("asks a material clarification and replans with the exact answer before approval", async () => {
    const run = await fixture(
      [
        structuredClone(ambiguousPlan),
        structuredClone(readyPlan),
        structuredClone(implementation),
        structuredClone(verification),
      ],
      [
        { status: "answered", value: "Expose it through the CLI" },
        { status: "answered", value: "run" },
      ],
    );

    if (!run.result.success) throw new Error(JSON.stringify(run.result, null, 2));
    expect(run.interactionCalls[0]).toMatchObject({
      kind: "input",
      title: "Which public seam should expose the probe?",
    });
    expect(run.agentCalls[1]?.task).toContain("Expose it through the CLI");
    expect(run.agentCalls[0]?.tools).toEqual(["read", "grep", "find", "ls"]);
    expect(run.agentCalls[0]?.thinking).toBe("low");
    expect(run.agentCalls[1]?.tools).toEqual([]);
    expect(run.agentCalls[1]?.thinking).toBe("low");
    expect(run.agentCalls[2]?.tools).toContain("edit");
  });

  it("carries repository evidence through one automatic and one explicit final clarification", async () => {
    const secondQuestion = {
      ...structuredClone(ambiguousPlan),
      questions: [{
        id: "output-format",
        prompt: "Which output format is authoritative?",
        reason: "The answer changes acceptance evidence.",
      }],
    };
    const run = await fixture(
      [
        structuredClone(ambiguousPlan),
        secondQuestion,
        structuredClone(readyPlan),
        structuredClone(implementation),
        structuredClone(verification),
      ],
      [
        { status: "answered", value: "Expose it through the CLI" },
        { status: "answered", value: "answer" },
        { status: "answered", value: "JSON" },
        { status: "answered", value: "run" },
      ],
    );

    if (!run.result.success) throw new Error(JSON.stringify(run.result, null, 2));
    expect(run.agentCalls[0]?.tools).toEqual(["read", "grep", "find", "ls"]);
    expect(run.agentCalls[1]?.tools).toEqual([]);
    expect(run.agentCalls[2]?.tools).toEqual([]);
    expect(run.agentCalls[1]?.task).toContain("src/probe.ts:1");
    expect(run.agentCalls[2]?.task).toContain('"output-format": "JSON"');
    expect(run.agentCalls[3]?.tools).toContain("edit");
  });

  it("offers an explicit decision and returns blocked instead of throwing when ambiguity remains", async () => {
    const secondQuestion = {
      ...structuredClone(ambiguousPlan),
      questions: [{ id: "format", prompt: "Which format?", reason: "Changes the contract." }],
    };
    const run = await fixture(
      [structuredClone(ambiguousPlan), secondQuestion],
      [
        { status: "answered", value: "CLI" },
        { status: "answered", value: "blocked" },
      ],
    );

    if (!run.result.success) throw new Error(JSON.stringify(run.result, null, 2));
    expect(run.result.value).toContain("# Implementation blocked");
    expect(run.interactionCalls.at(-1)).toMatchObject({
      kind: "select",
      title: "Planning still needs a material decision",
    });
    expect(run.interactionCalls.at(-1)?.choices).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "answer" }),
      expect.objectContaining({ id: "assume" }),
      expect.objectContaining({ id: "blocked" }),
      expect.objectContaining({ id: "cancel" }),
    ]));
    expect(run.agentCalls.every((call) => !Array.isArray(call.tools) || !call.tools.includes("edit"))).toBe(true);
  });

  it("requires normal workflow approval after explicitly accepting unresolved assumptions", async () => {
    const secondQuestion = {
      ...structuredClone(ambiguousPlan),
      questions: [{ id: "format", prompt: "Which format?", reason: "Changes the contract." }],
    };
    const run = await fixture(
      [
        structuredClone(ambiguousPlan),
        secondQuestion,
        structuredClone(implementation),
        structuredClone(verification),
      ],
      [
        { status: "answered", value: "CLI" },
        { status: "answered", value: "assume" },
        { status: "answered", value: "run" },
      ],
    );

    if (!run.result.success) throw new Error(JSON.stringify(run.result, null, 2));
    expect(String(run.interactionCalls.at(-1)?.markdown)).toContain(
      "User explicitly chose to proceed without resolving: Which format?",
    );
    expect(run.agentCalls[2]?.tools).toContain("edit");
    expect(run.result.value).toContain("# Implementation completed");
  });

  it("bounds a user-requested final clarification and can still report blocked", async () => {
    const question = (id: string) => ({
      ...structuredClone(ambiguousPlan),
      questions: [{ id, prompt: `Question ${id}?`, reason: "Material decision." }],
    });
    const run = await fixture(
      [question("one"), question("two"), question("three")],
      [
        { status: "answered", value: "one" },
        { status: "answered", value: "answer" },
        { status: "answered", value: "two" },
        { status: "answered", value: "blocked" },
      ],
    );

    if (!run.result.success) throw new Error(JSON.stringify(run.result, null, 2));
    expect(run.agentCalls).toHaveLength(3);
    expect(run.result.value).toContain("# Implementation blocked");
    expect(run.result.value).toContain("user-requested final clarification");
  });

  it("protects implementation evidence budget from repeated planning", async () => {
    const secondQuestion = {
      ...structuredClone(ambiguousPlan),
      questions: [{ id: "format", prompt: "Which format?", reason: "Changes the contract." }],
    };
    const run = await fixture(
      [structuredClone(ambiguousPlan), secondQuestion],
      [
        { status: "answered", value: "CLI" },
        { status: "answered", value: "blocked" },
      ],
      [40_000, 35_000],
    );

    if (!run.result.success) throw new Error(JSON.stringify(run.result, null, 2));
    const gate = run.interactionCalls.at(-1);
    expect(run.agentCalls).toHaveLength(2);
    expect(gate?.choices).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "answer" })]));
    expect(gate?.choices).toEqual(expect.arrayContaining([expect.objectContaining({ id: "assume" })]));
    expect(String(gate?.markdown)).toContain("25000 tokens remain");
  });

  it("does not offer mutation with assumptions after planning consumes its reserve", async () => {
    const run = await fixture(
      [structuredClone(ambiguousPlan)],
      [{ status: "answered", value: "blocked" }],
      [80_000],
    );

    if (!run.result.success) throw new Error(JSON.stringify(run.result, null, 2));
    const choices = run.interactionCalls[0]?.choices;
    expect(choices).toEqual([
      expect.objectContaining({ id: "blocked" }),
      expect.objectContaining({ id: "cancel" }),
    ]);
    expect(run.result.value).toContain("# Implementation blocked");
    expect(run.agentCalls).toHaveLength(1);
  });

  it("blocks an oversized approval artifact instead of silently truncating it", async () => {
    const oversized = {
      ...structuredClone(readyPlan),
      intent: { ...structuredClone(readyPlan.intent), outcome: "x".repeat(25_000) },
    };
    const run = await fixture([oversized], []);

    if (!run.result.success) throw new Error(JSON.stringify(run.result, null, 2));
    expect(run.result.value).toContain("# Implementation blocked");
    expect(run.result.value).toContain("interactive review limit");
    expect(run.agentCalls).toHaveLength(1);
    expect(run.interactionCalls).toHaveLength(0);
  });

  it("turns agent failures into blocked before mutation and partial after mutation", async () => {
    const before = await fixture([new Error("planner timeout")], []);
    if (!before.result.success) throw new Error(JSON.stringify(before.result, null, 2));
    expect(before.result.value).toContain("# Implementation blocked");
    expect(before.result.value).toContain("planning stopped safely: planner timeout");

    const after = await fixture(
      [structuredClone(readyPlan), new Error("implementation timeout")],
      [{ status: "answered", value: "run" }],
    );
    if (!after.result.success) throw new Error(JSON.stringify(after.result, null, 2));
    expect(after.result.value).toContain("# Implementation partial");
    expect(after.result.value).toContain("implementation stopped safely: implementation timeout");
  });

  it("bounds planner clarification titles to the interaction contract", async () => {
    const longPrompt = `Which public seam should expose the probe? ${"x".repeat(200)}`;
    const longQuestionPlan = {
      ...structuredClone(ambiguousPlan),
      questions: [{
        ...ambiguousPlan.questions[0],
        prompt: longPrompt,
        reason: "r".repeat(500),
      }],
    };
    const run = await fixture(
      [
        longQuestionPlan,
        structuredClone(readyPlan),
        structuredClone(implementation),
        structuredClone(verification),
      ],
      [
        { status: "answered", value: "Expose it through the CLI" },
        { status: "answered", value: "run" },
      ],
    );

    if (!run.result.success) throw new Error(JSON.stringify(run.result, null, 2));
    expect(String(run.interactionCalls[0]?.title)).toHaveLength(160);
    expect(longPrompt.startsWith(String(run.interactionCalls[0]?.title))).toBe(true);
    expect(String(run.interactionCalls[0]?.placeholder)).toHaveLength(240);
  });

  it("requires another visual approval for a material workflow change", async () => {
    const needsChange = {
      ...structuredClone(implementation),
      status: "needs_workflow_change",
      changedFiles: [],
      workflowChange: "The public seam requires a generated artifact check.",
    };
    const changedPlan = {
      ...structuredClone(readyPlan),
      checks: [
        ...readyPlan.checks,
        { label: "Built artifact", reason: "The public seam loads generated output." },
      ],
    };
    const run = await fixture(
      [
        structuredClone(readyPlan),
        needsChange,
        changedPlan,
        structuredClone(implementation),
        structuredClone(verification),
      ],
      [
        { status: "answered", value: "run" },
        { status: "answered", value: "run" },
      ],
    );

    if (!run.result.success) throw new Error(JSON.stringify(run.result, null, 2));
    expect(run.interactionCalls).toHaveLength(2);
    expect(run.interactionCalls.every((call) => String(call.markdown).includes("```mermaid"))).toBe(true);
    expect(run.agentCalls.filter((call) =>
      Array.isArray(call.tools) && call.tools.includes("edit"),
    )).toHaveLength(2);
  });

  it("replans one textual workflow revision before mutation", async () => {
    const revisedPlan = {
      ...structuredClone(readyPlan),
      rationale: "The requested revision keeps the change documentation-only.",
    };
    const run = await fixture(
      [
        structuredClone(readyPlan),
        revisedPlan,
        structuredClone(implementation),
        structuredClone(verification),
      ],
      [
        { status: "answered", value: "revise" },
        { status: "answered", value: "Keep the change documentation-only" },
        { status: "answered", value: "run" },
      ],
    );

    if (!run.result.success) throw new Error(JSON.stringify(run.result, null, 2));
    expect(run.interactionCalls).toHaveLength(3);
    expect(run.agentCalls[1]?.task).toContain("Keep the change documentation-only");
    expect(run.agentCalls.filter((call) =>
      Array.isArray(call.tools) && call.tools.includes("edit"),
    )).toHaveLength(1);
  });

  it("stops read-only when material clarification is cancelled", async () => {
    const run = await fixture(
      [structuredClone(ambiguousPlan)],
      [{ status: "cancelled" }],
    );

    if (!run.result.success) throw new Error(JSON.stringify(run.result, null, 2));
    expect(run.agentCalls).toHaveLength(1);
    expect(run.agentCalls[0]?.tools).toEqual(["read", "grep", "find", "ls"]);
    expect(run.result.value).toContain("Implementation cancelled");
  });

  it("stops after the read-only planner when approval is cancelled", async () => {
    const run = await fixture(
      [structuredClone(readyPlan)],
      [{ status: "cancelled" }],
    );

    if (!run.result.success) throw new Error(JSON.stringify(run.result, null, 2));
    expect(run.agentCalls).toHaveLength(1);
    expect(run.agentCalls[0]?.tools).toEqual(["read", "grep", "find", "ls"]);
    expect(run.result.value).toContain("Implementation cancelled");
    expect(run.result.value).toContain("did not authorize a commit, push, publication");
  });
});
