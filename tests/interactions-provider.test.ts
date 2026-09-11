import { initTheme, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { InteractionsProvider } from "../src/providers/interactions-provider.js";
import type { FabricInvocationContext } from "../src/protocol.js";

initTheme("dark", false);

const invocation = (extensionContext: ExtensionContext): FabricInvocationContext => ({
  cwd: process.cwd(),
  signal: undefined,
  parentToolCallId: "interactions-test",
  nestedToolCallId: "interactions-test",
  extensionContext,
  update() {},
});

describe("InteractionsProvider", () => {
  it("describes one ordered host-UI request capability", async () => {
    const provider = new InteractionsProvider();
    const context = invocation({} as ExtensionContext);

    const listed = await provider.list({}, context);
    expect(listed).toEqual([
      expect.objectContaining({
        name: "request",
        risk: "read",
        effect: { kind: "emission", resources: ["pi:ui"], ordering: "ordered" },
      }),
    ]);
    expect(listed[0]?.inputSchema.properties).not.toHaveProperty("multiline");
    expect(await provider.list({ query: "unrelated" }, context)).toEqual([]);
  });

  it("returns bounded text from Pi input and reports Escape as cancellation", async () => {
    const input = vi.fn()
      .mockResolvedValueOnce("answer\u0000")
      .mockResolvedValueOnce(undefined);
    const context = invocation({
      hasUI: true,
      mode: "tui",
      ui: { input },
    } as unknown as ExtensionContext);
    const provider = new InteractionsProvider();

    await expect(provider.invoke("request", {
      kind: "input",
      title: "Clarify",
      placeholder: "Your answer",
    }, context)).resolves.toEqual({ status: "answered", value: "answer" });
    await expect(provider.invoke("request", {
      kind: "input",
      title: "Clarify",
    }, context)).resolves.toEqual({ status: "cancelled" });
    expect(input).toHaveBeenNthCalledWith(
      1,
      "Clarify",
      "Your answer",
      expect.objectContaining({ timeout: 14 * 60 * 1_000 }),
    );
  });

  it("returns the selected workflow decision and rejects duplicate ids", async () => {
    const custom = vi.fn().mockResolvedValue("run");
    const context = invocation({
      hasUI: true,
      mode: "tui",
      ui: { custom },
    } as unknown as ExtensionContext);
    const provider = new InteractionsProvider();

    await expect(provider.invoke("request", {
      kind: "select",
      title: "Workflow",
      markdown: "```mermaid\nflowchart LR\n  A --> B\n```",
      choices: [
        { id: "run", label: "Run" },
        { id: "cancel", label: "Cancel" },
      ],
    }, context)).resolves.toEqual({ status: "answered", value: "run" });
    expect(custom).toHaveBeenCalledOnce();

    await expect(provider.invoke("request", {
      kind: "select",
      title: "Workflow",
      choices: [
        { id: "same", label: "One" },
        { id: "same", label: "Two" },
      ],
    }, context)).rejects.toThrow("choice id must be unique");
  });

  it("cancels a custom workflow prompt when execution is aborted", async () => {
    const controller = new AbortController();
    const custom = vi.fn(async (factory: Function) => {
      let resolveSelection!: (value: string | undefined) => void;
      const selection = new Promise<string | undefined>((resolve) => {
        resolveSelection = resolve;
      });
      await factory(
        { terminal: { columns: 80, rows: 24 }, requestRender() {} },
        { fg: (_name: string, text: string) => text, bold: (text: string) => text },
        {},
        resolveSelection,
      );
      controller.abort();
      return selection;
    });
    const context = {
      ...invocation({
        hasUI: true,
        mode: "tui",
        ui: { custom },
      } as unknown as ExtensionContext),
      signal: controller.signal,
    };
    const provider = new InteractionsProvider();

    await expect(provider.invoke("request", {
      kind: "select",
      title: "Workflow",
      choices: [{ id: "run", label: "Run" }],
    }, context)).resolves.toEqual({ status: "cancelled" });
  });

  it("keeps choices visible and pages a long rendered Mermaid proposal", async () => {
    let component: { render(width: number): string[]; handleInput?(data: string): void } | undefined;
    const requestRender = vi.fn();
    const custom = vi.fn(async (factory: Function) => {
      component = await factory(
        { terminal: { columns: 80, rows: 24 }, requestRender },
        { fg: (_name: string, text: string) => text, bold: (text: string) => text },
        {},
        () => {},
      );
      return "run";
    });
    const context = invocation({
      hasUI: true,
      mode: "tui",
      ui: { custom },
    } as unknown as ExtensionContext);
    const provider = new InteractionsProvider();
    const markdown = `## Proposal\n\n\`\`\`mermaid\nflowchart LR\n  A["Understand"] --> B["Implement"]\n  B --> C["Verify"]\n\`\`\`\n\n${Array.from({ length: 30 }, (_, index) => `- check ${index + 1}`).join("\n")}`;

    await provider.invoke("request", {
      kind: "select",
      title: "Workflow",
      prompt: "Approve or cancel",
      markdown,
      choices: [
        { id: "run", label: "Run workflow" },
        { id: "cancel", label: "Cancel" },
      ],
    }, context);

    const first = component!.render(80);
    expect(first.length).toBeLessThanOrEqual(24);
    expect(first.slice(0, 10).join("\n")).toContain("Run workflow");
    expect(first.join("\n")).toContain("Understand");
    expect(first.join("\n")).not.toContain("flowchart LR");
    component!.handleInput?.("\u001b[C");
    expect(requestRender).toHaveBeenCalledOnce();
    const second = component!.render(80);
    expect(second).not.toEqual(first);
    expect(second.slice(0, 10).join("\n")).toContain("Run workflow");
    expect(second.join("\n")).toContain("Proposal lines");
  });

  it("fails clearly outside an interactive Pi TUI", async () => {
    const provider = new InteractionsProvider();
    const context = invocation({ hasUI: false, mode: "print" } as ExtensionContext);

    await expect(provider.invoke("request", {
      kind: "input",
      title: "Task",
    }, context)).rejects.toThrow("requires Pi TUI mode");
  });
});
