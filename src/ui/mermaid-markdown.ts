import { render } from "grok-mermaid";

const MERMAID_FENCE = /```mermaid[^\n]*\n([\s\S]*?)```/gi;

/**
 * Replace renderable Mermaid fences with Unicode terminal art. Invalid or very
 * wide diagrams remain source fences, so presentation never blocks execution.
 */
export const renderMermaidForTerminal = (
  markdown: string,
  maximumWidth = 120,
): string => markdown.replace(MERMAID_FENCE, (fence, source: string) => {
  const art = render(source.trim());
  if (!art || art.width > maximumWidth) return fence;
  return `\`\`\`text\n${art.plain.join("\n")}\n\`\`\``;
});
