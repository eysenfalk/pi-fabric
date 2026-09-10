import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { FabricExecutionTraceRecorder } from "../src/audit/trace.js";
import { normalizeFabricConfig } from "../src/config.js";
import type { FabricState } from "../src/fabric-state.js";
import { createFabricExecTool } from "../src/fabric-exec-tool.js";
import { defaultCodePreviewSettings } from "../src/ui/code-preview.js";

const executionResult = () => ({
  success: true,
  kernel: "typescript" as const,
  value: "done",
  logs: [],
  audits: [],
  phases: [],
  trace: new FabricExecutionTraceRecorder().seal("succeeded", []),
  elapsedMs: 1,
});

const fixture = () => {
  const execute = vi.fn(async (_options: unknown) => executionResult());
  const resolveProgram = vi.fn(async () => ({
    name: "project/review",
    scope: "project" as const,
    kernel: "typescript" as const,
    description: "Review a request",
    parameters: { request: { type: "string" as const, required: true } },
    code: "return π.request;",
    payloads: { request: "Audit auth" },
    digest: "a".repeat(64),
  }));
  const state = {
    bootstrapped: true,
    initialized: true,
    config: normalizeFabricConfig({ executor: { kernel: "typescript" }, ui: { toolDisplay: "compact" } }),
    ensure: vi.fn(async () => {}),
    execution: { execute },
    resolveProgram,
    claimHandoff: vi.fn(async () => undefined),
  } as unknown as FabricState;
  const context = {
    cwd: "/project",
    isProjectTrusted: () => true,
    sessionManager: { getSessionId: () => "session-1" },
    ui: { setStatus: vi.fn() },
  } as unknown as ExtensionContext;
  const tool = createFabricExecTool(state, defaultCodePreviewSettings(), new Map(), (value) => value);
  return { tool, context, execute, resolveProgram };
};

describe("fabric_exec reusable program execution", () => {
  it("resolves a named program and executes its pinned body through the existing execution service", async () => {
    const { tool, context, execute, resolveProgram } = fixture();
    const result = await tool.execute!(
      "tool-1",
      { program: "project/review", payloads: { request: "Audit auth" } } as never,
      undefined,
      undefined,
      context,
    );

    expect(resolveProgram).toHaveBeenCalledWith(
      "project/review",
      { request: "Audit auth" },
      context,
    );
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      code: "return π.request;",
      strings: { request: "Audit auth" },
      parentToolCallId: "tool-1",
      context,
    });
    expect(result.details).toMatchObject({
      success: true,
      program: { name: "project/review", digest: "a".repeat(64) },
    });
  });

  it("keeps inline code compatible and rejects ambiguous or missing sources", async () => {
    const { tool, context, execute, resolveProgram } = fixture();
    await tool.execute!("tool-inline", { code: "return 1;" } as never, undefined, undefined, context);
    expect(execute.mock.calls[0]?.[0]).toMatchObject({ code: "return 1;" });
    expect(resolveProgram).not.toHaveBeenCalled();

    await expect(tool.execute!(
      "tool-both",
      { code: "return 1;", program: "project/review" } as never,
      undefined,
      undefined,
      context,
    )).rejects.toThrow("exactly one execution source");
    await expect(tool.execute!(
      "tool-neither",
      {} as never,
      undefined,
      undefined,
      context,
    )).rejects.toThrow("exactly one execution source");
    expect(execute).toHaveBeenCalledOnce();
  });
});
