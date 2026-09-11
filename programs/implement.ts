/**
 * Automatic implementation workflow for one bounded repository change.
 *
 * The Program owns order, gates, budgets, exact Skill binding, one repair pass,
 * and truthful completion. Agents retain judgment inside each small stage.
 *
 * Reading map:
 *   1. Contracts and bounded inputs
 *   2. Understand / clarify / visualize / approve
 *   3. Implement / verify / review once
 *   4. The linear executable workflow at the bottom of this file
 *
 * The schemas are intentionally local: Programs v1 are single source files, so
 * there is no hidden workflow engine or generated stage graph to inspect.
 */

type SkillSummary = { name: string; description: string };
type Question = { id: string; prompt: string; reason: string };
type Intent = {
  outcome: string;
  nonGoals: string[];
  acceptance: string[];
  risks: string[];
};
type WorkflowPlan = {
  needsInput: boolean;
  questions: Question[];
  intent: Intent;
  repositoryFacts: Array<{ fact: string; source: string }>;
  track: string;
  selectedSkills: string[];
  reviewRequired: boolean;
  implementationReason: string;
  checks: Array<{ label: string; reason: string }>;
  rationale: string;
};
type ImplementationReport = {
  status: "completed" | "blocked" | "needs_workflow_change";
  summary: string;
  changedFiles: string[];
  checksRun: string[];
  blockers: string[];
  workflowChange: string;
};
type VerificationReport = {
  ok: boolean;
  summary: string;
  evidence: string[];
  failures: string[];
  residualRisks: string[];
};
type ReviewReport = {
  verdict: "pass" | "needs_fix" | "blocked";
  summary: string;
  findings: Array<{ severity: "P0" | "P1" | "P2"; finding: string; evidence: string }>;
};
type InteractionResult = { status: "answered" | "cancelled"; value?: string };
type PlanningOutcome =
  | { status: "ready"; plan: WorkflowPlan }
  | { status: "cancelled"; plan: WorkflowPlan }
  | { status: "blocked"; plan: WorkflowPlan; reason: string };
type ApprovalOutcome =
  | { status: "approved"; plan: WorkflowPlan; markdown: string }
  | { status: "cancelled"; plan: WorkflowPlan }
  | { status: "blocked"; plan: WorkflowPlan; reason: string };

const READ_ONLY_TOOLS = ["read", "grep", "find", "ls"];
const VERIFY_TOOLS = [...READ_ONLY_TOOLS, "bash"];
const WRITE_TOOLS = [...READ_ONLY_TOOLS, "edit", "write", "bash"];
const CHILD_RUNTIME = { extensions: false };
const PLAN_SKILL = "fabric-implement-plan";
const CHANGE_SKILL = "fabric-implement-change";
const VERIFY_SKILL = "fabric-implement-verify";
const INTERNAL_SKILLS = [PLAN_SKILL, CHANGE_SKILL, VERIFY_SKILL];
const MAX_PLANNER_CALLS = 4;
const MAX_AUTOMATIC_CLARIFICATION_ROUNDS = 1;
const PLANNING_CALL_ALLOWANCE = 25_000;
const ROUTINE_MUTATION_RESERVE = 25_000;
const REVIEW_MUTATION_RESERVE = 40_000;
const EVIDENCE_CALL_RESERVE = 12_000;
let plannerCalls = 0;

const planSchema = {
  type: "object",
  properties: {
    needsInput: { type: "boolean" },
    questions: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          id: { type: "string", minLength: 1, maxLength: 60 },
          prompt: { type: "string", minLength: 1, maxLength: 160 },
          reason: { type: "string", minLength: 1, maxLength: 500 },
        },
        required: ["id", "prompt", "reason"],
        additionalProperties: false,
      },
    },
    intent: {
      type: "object",
      properties: {
        outcome: { type: "string", minLength: 1, maxLength: 800 },
        nonGoals: { type: "array", maxItems: 4, items: { type: "string", maxLength: 300 } },
        acceptance: { type: "array", maxItems: 6, items: { type: "string", maxLength: 300 } },
        risks: { type: "array", maxItems: 4, items: { type: "string", maxLength: 300 } },
      },
      required: ["outcome", "nonGoals", "acceptance", "risks"],
      additionalProperties: false,
    },
    repositoryFacts: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          fact: { type: "string", minLength: 1, maxLength: 400 },
          source: { type: "string", minLength: 1, maxLength: 240 },
        },
        required: ["fact", "source"],
        additionalProperties: false,
      },
    },
    track: { type: "string", minLength: 1, maxLength: 120 },
    selectedSkills: { type: "array", maxItems: 3, items: { type: "string", maxLength: 64 } },
    reviewRequired: { type: "boolean" },
    implementationReason: { type: "string", minLength: 1, maxLength: 600 },
    checks: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "object",
        properties: {
          label: { type: "string", minLength: 1, maxLength: 120 },
          reason: { type: "string", minLength: 1, maxLength: 300 },
        },
        required: ["label", "reason"],
        additionalProperties: false,
      },
    },
    rationale: { type: "string", minLength: 1, maxLength: 800 },
  },
  required: [
    "needsInput", "questions", "intent", "repositoryFacts", "track", "selectedSkills",
    "reviewRequired", "implementationReason", "checks", "rationale",
  ],
  additionalProperties: false,
} as const;

const implementationSchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["completed", "blocked", "needs_workflow_change"] },
    summary: { type: "string", maxLength: 2_000 },
    changedFiles: { type: "array", maxItems: 40, items: { type: "string", maxLength: 300 } },
    checksRun: { type: "array", maxItems: 20, items: { type: "string", maxLength: 500 } },
    blockers: { type: "array", maxItems: 8, items: { type: "string", maxLength: 500 } },
    workflowChange: { type: "string", maxLength: 1_200 },
  },
  required: ["status", "summary", "changedFiles", "checksRun", "blockers", "workflowChange"],
  additionalProperties: false,
} as const;

const verificationSchema = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    summary: { type: "string", maxLength: 2_000 },
    evidence: { type: "array", maxItems: 20, items: { type: "string", maxLength: 600 } },
    failures: { type: "array", maxItems: 12, items: { type: "string", maxLength: 600 } },
    residualRisks: { type: "array", maxItems: 8, items: { type: "string", maxLength: 600 } },
  },
  required: ["ok", "summary", "evidence", "failures", "residualRisks"],
  additionalProperties: false,
} as const;

const reviewSchema = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["pass", "needs_fix", "blocked"] },
    summary: { type: "string", maxLength: 2_000 },
    findings: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["P0", "P1", "P2"] },
          finding: { type: "string", maxLength: 800 },
          evidence: { type: "string", maxLength: 800 },
        },
        required: ["severity", "finding", "evidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["verdict", "summary", "findings"],
  additionalProperties: false,
} as const;

const task = π.task.trim();
const constraints = π.constraints.trim();
const sessionContext = π.sessionContext.trim();
if (!task) throw new Error("task must not be empty");

function parseSkillCatalog(raw: string): SkillSummary[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("skillCatalog must be valid JSON");
  }
  if (!Array.isArray(value)) throw new Error("skillCatalog must be a JSON array");
  return value.flatMap((candidate) => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return [];
    const record = candidate as Record<string, unknown>;
    if (typeof record.name !== "string" || typeof record.description !== "string") return [];
    return [{ name: record.name, description: record.description }];
  });
}

const skillCatalog = parseSkillCatalog(π.skillCatalog);
const skillNames = new Set(skillCatalog.map((skill) => skill.name));
for (const required of INTERNAL_SKILLS) {
  if (!skillNames.has(required)) {
    throw new Error(`The /implement host is missing its required Skill: ${required}`);
  }
}

function exactSkills(selected: string[]): string[] {
  const unique = [...new Set(selected)];
  const unknown = unique.filter((name) => !skillNames.has(name) || INTERNAL_SKILLS.includes(name));
  if (unknown.length > 0) {
    throw new Error(`Planner selected unavailable or reserved Skills: ${unknown.join(", ")}`);
  }
  return unique;
}

function clip(value: string, maximum: number): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, maximum);
}

async function askInput(
  title: string,
  options: { placeholder?: string; initial?: string } = {},
): Promise<InteractionResult> {
  return interactions.request({
    kind: "input",
    title: clip(title, 160).trim() || "Input required",
    ...(options.placeholder ? { placeholder: clip(options.placeholder, 240) } : {}),
    ...(options.initial ? { initial: clip(options.initial, 12_000) } : {}),
  }) as Promise<InteractionResult>;
}

async function askSelect(
  title: string,
  prompt: string,
  markdown: string,
  choices: Array<{ id: string; label: string; description?: string }>,
): Promise<InteractionResult> {
  const boundedMarkdown = clip(markdown, 24_001);
  if (boundedMarkdown.length > 24_000) {
    throw new Error("The workflow proposal exceeds the 24000-character interactive review limit; narrow the requested scope.");
  }
  if (choices.length === 0 || choices.length > 8) {
    throw new Error("A workflow decision must expose 1-8 complete choices.");
  }
  return interactions.request({
    kind: "select",
    title: clip(title, 160).trim() || "Decision required",
    prompt: clip(prompt, 2_000),
    markdown: boundedMarkdown,
    choices: choices.map((choice) => ({
      id: clip(choice.id, 80),
      label: clip(choice.label, 120),
      ...(choice.description ? { description: clip(choice.description, 240) } : {}),
    })),
  }) as Promise<InteractionResult>;
}

function mutationReserve(plan: WorkflowPlan): number {
  return plan.reviewRequired ? REVIEW_MUTATION_RESERVE : ROUTINE_MUTATION_RESERVE;
}

function canReplan(plan: WorkflowPlan): boolean {
  return plannerCalls < MAX_PLANNER_CALLS
    && workflow.budget.remaining() >= mutationReserve(plan) + PLANNING_CALL_ALLOWANCE;
}

function planningPrompt(
  answers: Record<string, string>,
  requestedRevision: string,
  previousPlan?: WorkflowPlan,
): string {
  return `Understand one requested repository change and propose the smallest sufficient workflow.

Task:
${task}

Constraints:
${constraints || "None supplied."}

Bounded recent session context:
${sessionContext || "None supplied."}

Human clarification answers accumulated so far:
${JSON.stringify(answers, null, 2)}

Requested workflow revision:
${requestedRevision || "None."}

Previous structured plan and repository evidence:
${previousPlan ? JSON.stringify(previousPlan, null, 2) : "No previous plan."}

Available specialist Skills (select only exact names that materially improve implementation):
${JSON.stringify(skillCatalog.filter((skill) => !INTERNAL_SKILLS.includes(skill.name)), null, 2)}

Inspect repository truth without editing. Record only decision-relevant repository facts with concrete
file, symbol, command, or documentation sources. Preserve previous facts and decisions unless a new
answer invalidates them; do not restart broad discovery on a clarification replan.

Ask all currently foreseeable questions in this result, and only when an answer materially changes
outcome, authority, architecture, or acceptance. Resolve ordinary reversible engineering choices
with the smallest safe default and record that default as a risk or assumption instead of asking.
Keep the workflow small: implementation and proportional verification are mandatory; independent
review is optional and justified only by risk or repository rules. Do not optimize for conceivable
0.001% edge cases, inventory unrelated problems, or authorize commits, publication, deployment,
production changes, destructive actions, or sensitive-data transmission.`;
}

async function proposeWorkflow(
  answers: Record<string, string>,
  requestedRevision = "",
  previousPlan?: WorkflowPlan,
): Promise<WorkflowPlan> {
  if (plannerCalls >= MAX_PLANNER_CALLS) {
    throw new Error(`Planner call budget exhausted (${MAX_PLANNER_CALLS})`);
  }
  plannerCalls++;
  await phase("Understand", {
    total: MAX_PLANNER_CALLS,
    description: previousPlan ? "Refine only decisions changed by human input" : "Extract intent and inspect repository truth",
  });
  const planned = await agent<WorkflowPlan>(planningPrompt(answers, requestedRevision, previousPlan), {
    label: requestedRevision ? "revise implementation workflow" : previousPlan ? "refine implementation workflow" : "understand and plan implementation",
    tools: previousPlan ? [] : READ_ONLY_TOOLS,
    skills: [PLAN_SKILL],
    ...CHILD_RUNTIME,
    thinking: "low",
    schema: planSchema,
  });
  if (!previousPlan) return planned;

  const facts = [...previousPlan.repositoryFacts, ...planned.repositoryFacts];
  const seen = new Set<string>();
  return {
    ...planned,
    repositoryFacts: facts.filter((fact) => {
      const key = `${fact.source}\u0000${fact.fact}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 8),
  };
}

async function askQuestions(
  plan: WorkflowPlan,
  answers: Record<string, string>,
): Promise<{ status: "answered" | "cancelled"; count: number }> {
  let count = 0;
  for (const question of plan.questions) {
    if (Object.prototype.hasOwnProperty.call(answers, question.id)) continue;
    const response = await askInput(question.prompt, { placeholder: question.reason });
    if (response.status === "cancelled") return { status: "cancelled", count };
    answers[question.id] = response.value?.trim().slice(0, 4_000) ?? "";
    count++;
  }
  return { status: "answered", count };
}

function ambiguityMarkdown(plan: WorkflowPlan, reason: string): string {
  return `## Planning needs a decision

**Why planning stopped:** ${reason}

### Current intent
${plan.intent.outcome}

### Remaining material questions
${list(plan.questions.map((question) => `**${question.prompt}** — ${question.reason}`), "Planner reported no concrete question")}

### Repository basis retained
${list(plan.repositoryFacts.map((fact) => `${fact.fact} — ${fact.source}`), "No repository facts reported")}

### Budget boundary
${workflow.budget.remaining()} tokens remain. ${mutationReserve(plan)} are reserved for implementation, verification${plan.reviewRequired ? ", and review" : ""}.

No repository mutation has started.`;
}

function assumeUnresolved(plan: WorkflowPlan): WorkflowPlan {
  const unresolved = plan.questions.map((question) =>
    `User explicitly chose to proceed without resolving: ${question.prompt}`,
  );
  return {
    ...plan,
    needsInput: false,
    questions: [],
    intent: {
      ...plan.intent,
      risks: [...new Set([...unresolved, ...plan.intent.risks])].slice(0, 4),
    },
    rationale: `${plan.rationale}\n\nThe user explicitly chose to proceed with the unresolved items shown at the decision gate.`,
  };
}

async function resolveAmbiguity(
  plan: WorkflowPlan,
  answers: Record<string, string>,
  requestedRevision: string,
  reason: string,
  allowFinalAnswer: boolean,
): Promise<PlanningOutcome> {
  const mayReplan = allowFinalAnswer && canReplan(plan)
    && plan.questions.some((question) => !Object.prototype.hasOwnProperty.call(answers, question.id));
  const mayAssume = workflow.budget.remaining() >= mutationReserve(plan);
  const decision = await askSelect(
    "Planning still needs a material decision",
    "Answer once more, explicitly accept the shown uncertainty, stop as blocked, or cancel.",
    ambiguityMarkdown(plan, reason),
    [
      ...(mayReplan ? [{ id: "answer", label: "Answer remaining questions", description: "Use one final bounded replan." }] : []),
      ...(mayAssume ? [{ id: "assume", label: "Proceed with shown assumptions", description: "Continue only after the normal workflow approval." }] : []),
      { id: "blocked", label: "Stop and report blocked", description: "Return an honest read-only result." },
      { id: "cancel", label: "Cancel", description: "Stop without repository mutation." },
    ],
  );
  if (decision.status === "cancelled" || decision.value === "cancel") {
    return { status: "cancelled", plan };
  }
  if (decision.value === "blocked") return { status: "blocked", plan, reason };
  if (decision.value === "assume") return { status: "ready", plan: assumeUnresolved(plan) };

  const response = await askQuestions(plan, answers);
  if (response.status === "cancelled") return { status: "cancelled", plan };
  if (response.count === 0 || !canReplan(plan)) {
    return { status: "blocked", plan, reason: "No bounded planning pass remained for another clarification." };
  }
  const finalPlan = await proposeWorkflow(answers, requestedRevision, plan);
  if (!finalPlan.needsInput) return { status: "ready", plan: finalPlan };
  return resolveAmbiguity(
    finalPlan,
    answers,
    requestedRevision,
    "Planning remained materially ambiguous after the user-requested final clarification.",
    false,
  );
}

async function clarify(
  initial: WorkflowPlan,
  requestedRevision = "",
): Promise<PlanningOutcome> {
  let plan = initial;
  const answers: Record<string, string> = {};
  for (let round = 0; plan.needsInput && round < MAX_AUTOMATIC_CLARIFICATION_ROUNDS; round++) {
    if (!canReplan(plan)) break;
    const response = await askQuestions(plan, answers);
    if (response.status === "cancelled") return { status: "cancelled", plan };
    if (response.count === 0) break;
    plan = await proposeWorkflow(answers, requestedRevision, plan);
  }
  if (!plan.needsInput) return { status: "ready", plan };

  const reason = plannerCalls >= MAX_PLANNER_CALLS
    ? `The planner call limit (${MAX_PLANNER_CALLS}) was reached.`
    : workflow.budget.remaining() < mutationReserve(plan) + PLANNING_CALL_ALLOWANCE
      ? "Another planning pass would consume the token reserve required for safe implementation and verification."
      : "The automatic clarification-round limit was reached.";
  return resolveAmbiguity(plan, answers, requestedRevision, reason, true);
}

function list(items: string[], empty = "None"): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : `- ${empty}`;
}

function mermaid(plan: WorkflowPlan): string {
  const review = plan.reviewRequired ? '  S3 --> S4["Review"]\n  S4 --> S5["Close"]' : '  S3 --> S5["Close"]';
  return `flowchart ${plan.reviewRequired ? "TD" : "LR"}
  S0["Understand ✓"] --> S1["Inspect ✓"]
  S1 --> S2["Implement"]
  S2 --> S3["Verify"]
${review}`;
}

function workflowMarkdown(plan: WorkflowPlan, revisionNote = ""): string {
  const specialists = exactSkills(plan.selectedSkills);
  const process = ["Understand ✓", "Inspect ✓", "Implement", "Verify", ...(plan.reviewRequired ? ["Review"] : []), "Close"].join("  →  ");
  return `## Proposed implementation workflow

\`\`\`mermaid
${mermaid(plan)}
\`\`\`

**Process:** ${process}

### Authority boundary
No commit, push, publication, deployment, production change, destructive action, sensitive-data transmission, or harness mutation is authorized by this workflow.

### Intent
${plan.intent.outcome}

### Non-goals
${list(plan.intent.nonGoals)}

### Assumptions and risks
${list(plan.intent.risks)}

### Repository basis
${list(plan.repositoryFacts.map((fact) => `${fact.fact} — ${fact.source}`), "No repository facts reported")}

### Stages
1. **Understand** — extract the observable outcome, authority, and genuine unknowns.
2. **Inspect** — trace the smallest existing repository seam without editing.
3. **Implement (${plan.track})** — ${plan.implementationReason}
4. **Verify** — exercise the changed behavior and applicable repository gates.
${plan.reviewRequired ? "5. **Review** — independently inspect the diff because the evidenced risk warrants it.\n6. **Close** — report actual evidence, residual risk, and workspace state." : "5. **Close** — report actual evidence, residual risk, and workspace state. Review is intentionally skipped for this bounded risk."}

### Skills
- Planning: ${PLAN_SKILL}
- Implementation: ${[CHANGE_SKILL, ...specialists].join(", ")}
- Verification: ${VERIFY_SKILL}

### Acceptance evidence
${plan.checks.map((check) => `- **${check.label}:** ${check.reason}`).join("\n")}

### Why this workflow?
${plan.rationale}${revisionNote ? `\n\n**Requested revision:** ${revisionNote}` : ""}`;
}

async function approveWorkflow(initial: WorkflowPlan): Promise<ApprovalOutcome> {
  let plan = initial;
  let revisionNote = "";
  for (let revision = 0; revision <= 1; revision++) {
    if (plan.needsInput) {
      return { status: "blocked", plan, reason: "Workflow reached approval with unresolved material questions." };
    }
    const markdown = workflowMarkdown(plan, revisionNote);
    const decision = await askSelect(
      "Run this implementation workflow?",
      revision === 0 ? "Approve, revise once, or cancel." : "Approve the revised workflow or cancel.",
      markdown,
      [
        { id: "run", label: "Run workflow", description: "Start repository mutation." },
        ...(revision === 0 ? [{ id: "revise", label: "Revise workflow", description: "Describe one change in plain text." }] : []),
        { id: "cancel", label: "Cancel", description: "Stop without repository mutation." },
      ],
    );
    if (decision.status === "cancelled" || decision.value === "cancel") {
      return { status: "cancelled", plan };
    }
    if (decision.value === "run") return { status: "approved", plan, markdown };

    const revisionResponse = await askInput("How should the workflow change?", {
      initial: revisionNote,
      placeholder: "Describe one bounded change",
    });
    if (revisionResponse.status === "cancelled") return { status: "cancelled", plan };
    revisionNote = revisionResponse.value?.trim().slice(0, 2_000) ?? "";
    if (!canReplan(plan)) {
      return {
        status: "blocked",
        plan,
        reason: "The requested revision would consume the token reserve required for implementation and verification.",
      };
    }
    const revised = await proposeWorkflow({}, revisionNote, plan);
    const clarified = await clarify(revised, revisionNote);
    if (clarified.status !== "ready") return clarified;
    plan = clarified.plan;
  }
  return { status: "blocked", plan, reason: "The single workflow-revision allowance was exhausted." };
}

function implementationPrompt(plan: WorkflowPlan, repairEvidence = ""): string {
  return `Implement the approved bounded repository change.

Task: ${task}
Constraints: ${constraints || "None supplied."}
Approved intent and workflow:
${JSON.stringify(plan, null, 2)}
${repairEvidence ? `\nVerified failures to repair:\n${repairEvidence}` : ""}

Stay inside the approved outcome and non-goals. Inspect before editing, use the smallest existing
seam, fix the demonstrated root cause, preserve unrelated work, and leave code another contributor
can understand. Run targeted behavioral evidence. If newly discovered facts materially change the
outcome, stage set, authority, or evidence plan, stop before that change and return
needs_workflow_change with a concise explanation. Do not perform delivery actions.`;
}

async function implement(plan: WorkflowPlan, repairEvidence = ""): Promise<ImplementationReport> {
  await phase(repairEvidence ? "Repair" : "Implement", {
    total: 1,
    description: repairEvidence ? "Repair only verified failures" : "Implement the approved outcome",
  });
  return agent<ImplementationReport>(implementationPrompt(plan, repairEvidence), {
    label: repairEvidence ? "repair verified implementation failures" : "implement approved change",
    tools: WRITE_TOOLS,
    skills: [CHANGE_SKILL, ...exactSkills(plan.selectedSkills)],
    ...CHILD_RUNTIME,
    schema: implementationSchema,
  });
}

async function verify(plan: WorkflowPlan, work: ImplementationReport): Promise<VerificationReport> {
  await phase("Verify", { total: 1, description: "Verify changed behavior and repository gates" });
  return agent<VerificationReport>(`Independently verify the actual workspace state.

Approved workflow:
${JSON.stringify(plan, null, 2)}

Implementation report (do not trust it without inspection):
${JSON.stringify(work, null, 2)}

Inspect the actual diff and run the smallest decisive checks for every acceptance item and applicable
repository gate. Do not edit. Report failures honestly; do not invent confidence from a build alone.`, {
    label: "verify implementation evidence",
    tools: VERIFY_TOOLS,
    skills: [VERIFY_SKILL],
    ...CHILD_RUNTIME,
    schema: verificationSchema,
  });
}

async function review(
  plan: WorkflowPlan,
  work: ImplementationReport,
  verification: VerificationReport,
): Promise<ReviewReport> {
  await phase("Review", { total: 1, description: "Review only material defects" });
  return agent<ReviewReport>(`Review the actual diff as a pragmatic principal engineer.

Approved workflow:
${JSON.stringify(plan, null, 2)}
Implementation:
${JSON.stringify(work, null, 2)}
Verification:
${JSON.stringify(verification, null, 2)}

Do not edit. Report only evidenced P0-P2 correctness, safety, contract, maintainability, or missing-test
defects. Do not demand speculative cleanup, abstractions, or handling of immaterial edge cases.`, {
    label: "review verified implementation",
    tools: VERIFY_TOOLS,
    skills: [VERIFY_SKILL],
    ...CHILD_RUNTIME,
    schema: reviewSchema,
  });
}

function finalMarkdown(
  status: "completed" | "partial" | "cancelled" | "blocked",
  plan: WorkflowPlan | undefined,
  work: ImplementationReport | undefined,
  verification: VerificationReport | undefined,
  reviewReport: ReviewReport | undefined,
): string {
  const title = status === "completed" ? "Implementation completed" : `Implementation ${status}`;
  return `# ${title}

${plan ? `\`\`\`mermaid\n${mermaid(plan)}\n\`\`\`` : "The workflow stopped before approval; no repository mutation was started."}

## Intent
${plan?.intent.outcome ?? task}

## Changed files
${list(work?.changedFiles ?? [], "None reported")}

## Evidence
${list(verification?.evidence ?? work?.checksRun ?? [], "No completed evidence")}

## Failed or unverified
${list([...(verification?.failures ?? []), ...(work?.blockers ?? [])], "None reported")}

## Review
${reviewReport ? `${reviewReport.verdict}: ${reviewReport.summary}` : plan?.reviewRequired ? "Not completed." : "Skipped by the approved risk-based workflow."}

## Residual risk
${list(verification?.residualRisks ?? [], "None reported")}

## Delivery state
This workflow did not authorize a commit, push, publication, deployment, or production change. Their absence is established only when the evidence above reports it.`;
}

function stoppedWork(reason: string): ImplementationReport {
  return {
    status: "blocked",
    summary: reason,
    changedFiles: [],
    checksRun: [],
    blockers: [reason],
    workflowChange: "",
  };
}

function mergeWork(previous: ImplementationReport, next: ImplementationReport): ImplementationReport {
  return {
    ...next,
    changedFiles: [...new Set([...previous.changedFiles, ...next.changedFiles])],
    checksRun: [...new Set([...previous.checksRun, ...next.checksRun])],
    blockers: [...new Set([...previous.blockers, ...next.blockers])],
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runProgram(): Promise<string> {
  let plan: WorkflowPlan | undefined;
  let work: ImplementationReport | undefined;
  let verification: VerificationReport | undefined;
  let reviewReport: ReviewReport | undefined;
  let mutationStarted = false;
  let stage = "planning";

  try {
    await workflow.configure({ name: "Implement", description: task.slice(0, 160) });

    const planning = await clarify(await proposeWorkflow({}));
    plan = planning.plan;
    if (planning.status === "cancelled") {
      return finalMarkdown("cancelled", plan, undefined, undefined, undefined);
    }
    if (planning.status === "blocked") {
      return finalMarkdown("blocked", plan, stoppedWork(planning.reason), undefined, undefined);
    }

    stage = "workflow approval";
    const approved = await approveWorkflow(planning.plan);
    plan = approved.plan;
    if (approved.status === "cancelled") {
      return finalMarkdown("cancelled", plan, undefined, undefined, undefined);
    }
    if (approved.status === "blocked") {
      return finalMarkdown("blocked", plan, stoppedWork(approved.reason), undefined, undefined);
    }
    if (workflow.budget.remaining() < mutationReserve(plan)) {
      return finalMarkdown(
        "blocked",
        plan,
        stoppedWork("The approved workflow cannot start because its implementation and evidence token reserve is no longer available."),
        undefined,
        undefined,
      );
    }

    await workflow.event({ message: "Workflow approved; repository mutation may begin", level: "success" });
    stage = "implementation";
    mutationStarted = true;
    work = await implement(plan);

    if (work.status === "needs_workflow_change") {
      stage = "workflow change planning";
      if (!canReplan(plan)) {
        work.blockers.push("The discovered workflow change could not be replanned within the protected token and planner-call budget.");
        return finalMarkdown("partial", plan, work, undefined, undefined);
      }
      const changedPlanning = await clarify(
        await proposeWorkflow({}, work.workflowChange, plan),
        work.workflowChange,
      );
      if (changedPlanning.status !== "ready") {
        if (changedPlanning.status === "blocked") work.blockers.push(changedPlanning.reason);
        return finalMarkdown("partial", plan, work, undefined, undefined);
      }
      stage = "workflow change approval";
      const changedApproval = await approveWorkflow(changedPlanning.plan);
      if (changedApproval.status !== "approved") {
        if (changedApproval.status === "blocked") work.blockers.push(changedApproval.reason);
        return finalMarkdown("partial", plan, work, undefined, undefined);
      }
      plan = changedApproval.plan;
      if (workflow.budget.remaining() < mutationReserve(plan)) {
        work.blockers.push("The approved workflow change left too little protected budget for implementation and evidence.");
        return finalMarkdown("partial", plan, work, undefined, undefined);
      }
      stage = "changed implementation";
      work = mergeWork(work, await implement(plan));
    }

    if (work.status !== "completed") {
      return finalMarkdown("partial", plan, work, undefined, undefined);
    }
    if (workflow.budget.remaining() < EVIDENCE_CALL_RESERVE) {
      work.blockers.push("Verification was not started because its protected token reserve was unavailable.");
      return finalMarkdown("partial", plan, work, undefined, undefined);
    }

    stage = "verification";
    verification = await verify(plan, work);
    let repaired = false;
    if (!verification.ok) {
      if (workflow.budget.remaining() < EVIDENCE_CALL_RESERVE) {
        return finalMarkdown("partial", plan, work, verification, undefined);
      }
      stage = "verified repair";
      work = mergeWork(work, await implement(plan, verification.failures.join("\n")));
      repaired = true;
      if (work.status === "completed" && workflow.budget.remaining() >= EVIDENCE_CALL_RESERVE) {
        stage = "repair verification";
        verification = await verify(plan, work);
      }
    }

    if (verification.ok && plan.reviewRequired) {
      if (workflow.budget.remaining() < EVIDENCE_CALL_RESERVE) {
        work.blockers.push("Independent review was required but not started because its protected token reserve was unavailable.");
        return finalMarkdown("partial", plan, work, verification, undefined);
      }
      stage = "review";
      reviewReport = await review(plan, work, verification);
      if (reviewReport.verdict === "needs_fix" && !repaired) {
        if (workflow.budget.remaining() < EVIDENCE_CALL_RESERVE) {
          return finalMarkdown("partial", plan, work, verification, reviewReport);
        }
        stage = "review repair";
        work = mergeWork(
          work,
          await implement(plan, reviewReport.findings.map((finding) => finding.finding).join("\n")),
        );
        if (work.status === "completed" && workflow.budget.remaining() >= EVIDENCE_CALL_RESERVE) {
          stage = "review repair verification";
          verification = await verify(plan, work);
          if (verification.ok && workflow.budget.remaining() >= EVIDENCE_CALL_RESERVE) {
            stage = "final review";
            reviewReport = await review(plan, work, verification);
          }
        }
      }
    }

    const complete = verification.ok && (!reviewReport || reviewReport.verdict === "pass");
    await workflow.event({
      message: complete ? "Implementation workflow completed" : "Implementation workflow stopped with partial evidence",
      level: complete ? "success" : "warning",
    });
    return finalMarkdown(complete ? "completed" : "partial", plan, work, verification, reviewReport);
  } catch (error) {
    const reason = `${stage} stopped safely: ${errorMessage(error)}`;
    const failure = work ?? stoppedWork(reason);
    if (!failure.blockers.includes(reason)) failure.blockers.push(reason);
    return finalMarkdown(mutationStarted ? "partial" : "blocked", plan, failure, verification, reviewReport);
  }
}

return runProgram();
