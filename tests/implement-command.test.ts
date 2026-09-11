import {
  initTheme,
  type ExtensionAPI,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
  buildImplementSessionContext,
  IMPLEMENT_RESULT_MESSAGE_TYPE,
  registerImplementCommand,
} from "../src/commands/implement.js";
import type { FabricState } from "../src/fabric-state.js";

initTheme("dark", false);

const entry = (role: "user" | "assistant", content: string) => ({
  type: "message",
  message: { role, content },
});

const fakeCustom = async <T>(
  factory: (
    tui: { requestRender(): void },
    theme: { fg(_color: string, text: string): string; bold(text: string): string },
    keybindings: object,
    done: (value: T) => void,
  ) => unknown,
): Promise<T> => new Promise<T>((resolve) => {
  let component: { dispose?: () => void } | undefined;
  component = factory(
    { requestRender() {} },
    { fg: (_color, text) => text, bold: (text) => text },
    {},
    (value) => {
      component?.dispose?.();
      resolve(value);
    },
  ) as { dispose?: () => void };
});

describe("/implement command", () => {
  it("projects only six recent user/assistant prose messages", () => {
    const context = buildImplementSessionContext([
      entry("user", "PRIVATE_SENTINEL"),
      { type: "tool_result", message: { role: "toolResult", content: "TOOL_SENTINEL" } },
      entry("assistant", "one"),
      entry("user", "two"),
      entry("assistant", "three"),
      entry("user", "four"),
      entry("assistant", "five"),
      entry("user", "six"),
    ]);

    expect(context).not.toContain("PRIVATE_SENTINEL");
    expect(context).not.toContain("TOOL_SENTINEL");
    expect(context).toContain("ASSISTANT: one");
    expect(context).toContain("USER: six");
  });

  it("collects task then constraints and invokes the built-in Program through its executor", async () => {
    let handler: ((args: string, context: ExtensionCommandContext) => Promise<void>) | undefined;
    const registerMessageRenderer = vi.fn();
    const sendMessage = vi.fn();
    const pi = {
      registerCommand: vi.fn((_name, definition) => { handler = definition.handler; }),
      registerMessageRenderer,
      sendMessage,
    } as unknown as ExtensionAPI;
    const ensure = vi.fn(async () => {});
    const setHostSkills = vi.fn();
    const state = {
      ensure,
      setHostSkills,
      hostSkillCatalog: () => [{ name: "fabric-implement-plan", description: "Plan" }],
    } as unknown as FabricState;
    const execute = vi.fn(async () => ({
      content: [{ type: "text", text: "# Implementation completed" }],
      isError: false,
    }));
    const input = vi.fn()
      .mockResolvedValueOnce("  exact task  ")
      .mockResolvedValueOnce("exact constraints");
    const setStatus = vi.fn();
    const notify = vi.fn();
    const context = {
      hasUI: true,
      mode: "tui",
      ui: { input, custom: fakeCustom, setStatus, notify },
      sessionManager: { getBranch: () => [entry("user", "recent context")] },
      getSystemPromptOptions: () => ({
        skills: [{ name: "repository-quality", description: "Repository quality" }],
      }),
    } as unknown as ExtensionCommandContext;

    registerImplementCommand(pi, { state, execute });
    await handler!("", context);

    expect(input.mock.calls.map((call) => call[0])).toEqual([
      "What should be implemented?",
      "Which constraints matter? (optional)",
    ]);
    expect(setHostSkills).toHaveBeenCalledWith([
      { name: "repository-quality", description: "Repository quality" },
    ]);
    expect(ensure).toHaveBeenCalledWith(context);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        program: "builtin/implement",
        payloads: {
          task: "  exact task  ",
          constraints: "exact constraints",
          sessionContext: "USER: recent context",
          skillCatalog: JSON.stringify([{ name: "fabric-implement-plan", description: "Plan" }]),
        },
        resultFormat: "text",
        tokenBudget: 90_000,
        agentBudget: 14,
      }),
      expect.any(AbortSignal),
      expect.any(Function),
      context,
    );
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      customType: IMPLEMENT_RESULT_MESSAGE_TYPE,
      content: "# Implementation completed",
      display: true,
    }));
    expect(setStatus).toHaveBeenLastCalledWith("fabric-implement", undefined);
    expect(registerMessageRenderer).toHaveBeenCalledWith(
      IMPLEMENT_RESULT_MESSAGE_TYPE,
      expect.any(Function),
    );
  });

  it("cancels either input boundary before runtime initialization or execution", async () => {
    for (const answers of [[undefined], ["task", undefined]]) {
      let handler: ((args: string, context: ExtensionCommandContext) => Promise<void>) | undefined;
      const pi = {
        registerCommand: vi.fn((_name, definition) => { handler = definition.handler; }),
        registerMessageRenderer: vi.fn(),
      } as unknown as ExtensionAPI;
      const ensure = vi.fn(async () => {});
      const execute = vi.fn();
      const input = vi.fn();
      for (const answer of answers) input.mockResolvedValueOnce(answer);
      const context = {
        hasUI: true,
        mode: "tui",
        ui: { input, notify: vi.fn() },
      } as unknown as ExtensionCommandContext;

      registerImplementCommand(pi, {
        state: { ensure, hostSkillCatalog: () => [] } as unknown as FabricState,
        execute,
      });
      await handler!("", context);

      expect(ensure).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    }
  });
});
