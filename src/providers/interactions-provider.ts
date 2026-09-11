import { DynamicBorder, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import {
  Container,
  Key,
  Markdown,
  matchesKey,
  SelectList,
  Text,
  type SelectItem,
} from "@earendil-works/pi-tui";
import { renderMermaidForTerminal } from "../ui/mermaid-markdown.js";
import type {
  FabricActionDescriptor,
  FabricInvocationContext,
  FabricProvider,
  FabricProviderListRequest,
} from "../protocol.js";

const MAX_MARKDOWN_CHARS = 24_000;
const MAX_TEXT_CHARS = 12_000;
const MAX_CHOICES = 8;
const HUMAN_RESPONSE_TIMEOUT_MS = 14 * 60 * 1_000;

interface InteractionChoice {
  id: string;
  label: string;
  description?: string;
}

const descriptor: FabricActionDescriptor = {
  name: "request",
  description:
    "Request bounded human input in the active Pi UI, optionally with a Markdown workflow preview.",
  inputSchema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["input", "select"] },
      title: { type: "string", minLength: 1, maxLength: 160 },
      prompt: { type: "string", maxLength: 2_000 },
      markdown: { type: "string", maxLength: MAX_MARKDOWN_CHARS },
      placeholder: { type: "string", maxLength: 240 },
      initial: { type: "string", maxLength: MAX_TEXT_CHARS },
      choices: {
        type: "array",
        minItems: 1,
        maxItems: MAX_CHOICES,
        items: {
          type: "object",
          properties: {
            id: { type: "string", minLength: 1, maxLength: 80 },
            label: { type: "string", minLength: 1, maxLength: 120 },
            description: { type: "string", maxLength: 240 },
          },
          required: ["id", "label"],
          additionalProperties: false,
        },
      },
    },
    required: ["kind", "title"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["answered", "cancelled"] },
      value: { type: "string" },
    },
    required: ["status"],
    additionalProperties: false,
  },
  risk: "read",
  effect: { kind: "emission", resources: ["pi:ui"], ordering: "ordered" },
};

const clean = (value: unknown, maximum: number): string => {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .slice(0, maximum);
};

const parseChoices = (value: unknown): InteractionChoice[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CHOICES) {
    throw new Error(`interactions.request select requires 1-${MAX_CHOICES} choices`);
  }
  const ids = new Set<string>();
  return value.map((candidate) => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      throw new Error("interactions.request choices must be objects");
    }
    const record = candidate as Record<string, unknown>;
    const id = clean(record.id, 80).trim();
    const label = clean(record.label, 120).trim();
    if (!id || !label) throw new Error("interactions.request choices require id and label");
    if (ids.has(id)) throw new Error(`interactions.request choice id must be unique: ${id}`);
    ids.add(id);
    const description = clean(record.description, 240).trim();
    return { id, label, ...(description ? { description } : {}) };
  });
};

export class InteractionsProvider implements FabricProvider {
  readonly name = "interactions";
  readonly description =
    "Bounded human input and Markdown workflow approval through Pi's active UI.";

  async list(
    request: FabricProviderListRequest,
    _context: FabricInvocationContext,
  ): Promise<FabricActionDescriptor[]> {
    const query = request.query?.normalize("NFKC").trim().toLowerCase();
    if (query && !`${descriptor.name} ${descriptor.description}`.toLowerCase().includes(query)) {
      return [];
    }
    return [descriptor];
  }

  async describe(
    actionName: string,
    _context: FabricInvocationContext,
  ): Promise<FabricActionDescriptor | undefined> {
    return actionName === descriptor.name ? descriptor : undefined;
  }

  async invoke(
    actionName: string,
    args: Record<string, unknown>,
    context: FabricInvocationContext,
  ): Promise<unknown> {
    if (actionName !== "request") throw new Error(`Unknown interactions action: ${actionName}`);
    const extensionContext = context.extensionContext;
    if (!extensionContext.hasUI || extensionContext.mode !== "tui") {
      throw new Error("interactions.request requires Pi TUI mode");
    }
    if (context.signal?.aborted) return { status: "cancelled" };

    const kind = args.kind;
    const title = clean(args.title, 160).trim();
    if (!title) throw new Error("interactions.request requires title");
    context.update(`Waiting for user: ${title}`);

    if (kind === "input") {
      const initial = clean(args.initial, MAX_TEXT_CHARS);
      const value = await extensionContext.ui.input(
        title,
        clean(args.placeholder, 240),
        {
          timeout: HUMAN_RESPONSE_TIMEOUT_MS,
          ...(context.signal ? { signal: context.signal } : {}),
        },
      );
      return value === undefined
        ? { status: "cancelled" }
        : { status: "answered", value: clean(value, MAX_TEXT_CHARS) };
    }

    if (kind !== "select") {
      throw new Error('interactions.request kind must be "input" or "select"');
    }
    const choices = parseChoices(args.choices);
    const markdown = clean(args.markdown, MAX_MARKDOWN_CHARS);
    const prompt = clean(args.prompt, 2_000).trim();
    context.attachPreview?.({ kind: "markdown", markdown });

    let cleanupPrompt = () => {};
    let selected: string | undefined;
    try {
      selected = await extensionContext.ui.custom<string | undefined>(
      (tui, theme, _keybindings, done) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const onAbort = () => finish(undefined);
        const cleanup = () => {
          if (timer) clearTimeout(timer);
          context.signal?.removeEventListener("abort", onAbort);
        };
        const finish = (value: string | undefined) => {
          if (settled) return;
          settled = true;
          cleanup();
          done(value);
        };
        cleanupPrompt = cleanup;
        timer = setTimeout(() => finish(undefined), HUMAN_RESPONSE_TIMEOUT_MS);
        timer.unref?.();
        context.signal?.addEventListener("abort", onAbort, { once: true });
        const chrome = new Container();
        chrome.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
        chrome.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
        if (prompt) chrome.addChild(new Text(theme.fg("muted", prompt), 1, 0));

        const items: SelectItem[] = choices.map((choice) => ({
          value: choice.id,
          label: choice.label,
          ...(choice.description ? { description: choice.description } : {}),
        }));
        const list = new SelectList(items, Math.min(items.length, MAX_CHOICES), {
          selectedPrefix: (text) => theme.fg("accent", text),
          selectedText: (text) => theme.fg("accent", text),
          description: (text) => theme.fg("muted", text),
          scrollInfo: (text) => theme.fg("dim", text),
          noMatch: (text) => theme.fg("warning", text),
        });
        list.onSelect = (item) => finish(item.value);
        list.onCancel = () => finish(undefined);
        chrome.addChild(list);
        chrome.addChild(new Text(
          theme.fg("dim", "↑↓ choose • enter select • esc cancel • ←→ or PgUp/PgDn inspect"),
          1,
          0,
        ));

        const proposal = new Markdown(
          renderMermaidForTerminal(markdown, Math.max(20, tui.terminal.columns - 2)),
          1,
          1,
          getMarkdownTheme(),
        );
        const bottomBorder = new DynamicBorder((text: string) => theme.fg("accent", text));
        let offset = 0;
        let pageSize = 8;

        return {
          render: (width: number) => {
            const chromeLines = chrome.render(width);
            const proposalLines = proposal.render(width);
            // Pi can render Fabric activity and footer chrome outside this custom component.
            // Reserve enough rows so the paging indicator and controls remain visible.
            pageSize = Math.max(6, tui.terminal.rows - chromeLines.length - 8);
            const maximumOffset = Math.max(0, proposalLines.length - pageSize);
            offset = Math.min(offset, maximumOffset);
            const visible = proposalLines.slice(offset, offset + pageSize);
            const position = proposalLines.length > pageSize
              ? theme.fg("dim", `  Proposal lines ${offset + 1}–${offset + visible.length}/${proposalLines.length}`)
              : "";
            return [...chromeLines, ...visible, position, ...bottomBorder.render(width)];
          },
          dispose: cleanup,
          invalidate: () => {
            chrome.invalidate();
            proposal.invalidate();
            bottomBorder.invalidate();
          },
          handleInput: (data: string) => {
            if (matchesKey(data, Key.left) || matchesKey(data, Key.pageUp)) {
              offset = Math.max(0, offset - pageSize);
            } else if (matchesKey(data, Key.right) || matchesKey(data, Key.pageDown)) {
              offset += pageSize;
            }
            else list.handleInput(data);
            tui.requestRender();
          },
        };
      },
      );
    } finally {
      cleanupPrompt();
    }

    return selected === undefined
      ? { status: "cancelled" }
      : { status: "answered", value: selected };
  }
}
