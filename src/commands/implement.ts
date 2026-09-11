import {
  BorderedLoader,
  getMarkdownTheme,
  type ExtensionAPI,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";
import type { FabricState } from "../fabric-state.js";
import { renderMermaidForTerminal } from "../ui/mermaid-markdown.js";

export const IMPLEMENT_RESULT_MESSAGE_TYPE = "pi-fabric:implement-result:v1";
const SESSION_MESSAGE_LIMIT = 6;
const SESSION_CONTEXT_CHARS = 10_000;
const SESSION_MESSAGE_CHARS = 2_400;

interface ToolTextBlock {
  type: string;
  text?: string;
}

interface ImplementExecutionResult {
  content: ToolTextBlock[];
  isError?: boolean;
}

export interface ImplementCommandDependencies {
  state: FabricState;
  execute(
    args: {
      program: string;
      payloads: Record<string, string>;
      resultFormat: "text";
      timeoutMs: number;
      tokenBudget: number;
      agentBudget: number;
    },
    signal: AbortSignal,
    onUpdate: (update: unknown) => void,
    context: ExtensionCommandContext,
  ): Promise<ImplementExecutionResult>;
}

const textContent = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) => {
      if (typeof block !== "object" || block === null || Array.isArray(block)) return [];
      const record = block as Record<string, unknown>;
      return record.type === "text" && typeof record.text === "string" ? [record.text] : [];
    })
    .join("\n");
};

const sessionMessage = (entry: unknown): { role: "user" | "assistant"; text: string } | undefined => {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return undefined;
  const record = entry as Record<string, unknown>;
  if (record.type !== "message" || typeof record.message !== "object" || record.message === null) {
    return undefined;
  }
  const message = record.message as Record<string, unknown>;
  if (message.role !== "user" && message.role !== "assistant") return undefined;
  const text = textContent(message.content).trim();
  return text ? { role: message.role, text } : undefined;
};

/**
 * Project only recent human/assistant prose. Tool output, hidden messages,
 * custom state, thinking, and older transcript content stay out by default.
 */
export const buildImplementSessionContext = (entries: readonly unknown[]): string => {
  const messages = entries
    .flatMap((entry) => {
      const message = sessionMessage(entry);
      return message ? [message] : [];
    })
    .slice(-SESSION_MESSAGE_LIMIT)
    .map(({ role, text }) => `${role.toUpperCase()}: ${text.slice(0, SESSION_MESSAGE_CHARS)}`);
  return messages.join("\n\n").slice(-SESSION_CONTEXT_CHARS);
};

const resultText = (result: ImplementExecutionResult): string =>
  result.content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text!)
    .join("\n\n")
    .trim();

export const registerImplementCommand = (
  pi: ExtensionAPI,
  dependencies: ImplementCommandDependencies,
): void => {
  pi.registerMessageRenderer(IMPLEMENT_RESULT_MESSAGE_TYPE, (message) => {
    const content = typeof message.content === "string" ? message.content : "";
    return new Markdown(renderMermaidForTerminal(content), 0, 0, getMarkdownTheme());
  });

  pi.registerCommand("implement", {
    description: "Implement one bounded change through an approved visual workflow",
    handler: async (argumentsText, context) => {
      if (!context.hasUI || context.mode !== "tui") {
        context.ui.notify("/implement requires Pi TUI mode", "error");
        return;
      }

      const task = argumentsText.length > 0
        ? argumentsText
        : await context.ui.input("What should be implemented?", "Describe the observable outcome");
      if (task === undefined || task.trim().length === 0) {
        context.ui.notify("Implementation cancelled: task is required", "info");
        return;
      }

      const constraints = await context.ui.input(
        "Which constraints matter? (optional)",
        "Scope, authority, quality, delivery, or leave empty",
      );
      if (constraints === undefined) {
        context.ui.notify("Implementation cancelled before workflow planning", "info");
        return;
      }

      if (typeof context.getSystemPromptOptions === "function") {
        dependencies.state.setHostSkills(context.getSystemPromptOptions().skills ?? []);
      }
      await dependencies.state.ensure(context);
      const sessionContext = buildImplementSessionContext(
        context.sessionManager?.getBranch?.() ?? [],
      );
      const skillCatalog = JSON.stringify(dependencies.state.hostSkillCatalog());
      context.ui.setStatus("fabric-implement", "Planning implementation workflow…");

      type Outcome =
        | { status: "completed"; result: ImplementExecutionResult }
        | { status: "cancelled" }
        | { status: "failed"; error: Error };

      let outcome: Outcome;
      try {
        outcome = await context.ui.custom<Outcome>((tui, theme, _keybindings, done) => {
          let settled = false;
          const finish = (value: Outcome): void => {
            if (settled) return;
            settled = true;
            done(value);
          };
          const loader = new BorderedLoader(
            tui,
            theme,
            "Running approved implementation workflow…",
            { cancellable: true },
          );
          loader.onAbort = () => finish({ status: "cancelled" });
          void dependencies.execute({
            program: "builtin/implement",
            payloads: { task, constraints, sessionContext, skillCatalog },
            resultFormat: "text",
            timeoutMs: 30 * 60 * 1_000,
            tokenBudget: 90_000,
            agentBudget: 14,
          }, loader.signal, () => {
            context.ui.setStatus("fabric-implement", "Implementation workflow active…");
          }, context).then(
            (result) => finish({ status: "completed", result }),
            (error: unknown) => finish({
              status: "failed",
              error: error instanceof Error ? error : new Error(String(error)),
            }),
          );
          return loader;
        });
      } finally {
        context.ui.setStatus("fabric-implement", undefined);
      }

      if (outcome.status === "cancelled") {
        context.ui.notify("Implementation workflow cancelled", "info");
        return;
      }
      if (outcome.status === "failed") {
        context.ui.notify(`Implementation failed: ${outcome.error.message}`, "error");
        return;
      }

      const markdown = resultText(outcome.result);
      if (markdown) {
        pi.sendMessage({
          customType: IMPLEMENT_RESULT_MESSAGE_TYPE,
          content: markdown,
          display: true,
          details: { program: "builtin/implement", isError: outcome.result.isError === true },
        });
      }
      if (outcome.result.isError) {
        context.ui.notify("Implementation workflow stopped with an error", "error");
      }
    },
  });
};
