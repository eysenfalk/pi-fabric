import { describe, expect, it } from "vitest";
import { renderMermaidForTerminal } from "../src/ui/mermaid-markdown.js";

describe("renderMermaidForTerminal", () => {
  it("turns a Mermaid workflow fence into readable Unicode art", () => {
    const rendered = renderMermaidForTerminal(`## Workflow

\`\`\`mermaid
flowchart TD
  A["Understand"] --> B["Implement"]
  B --> C["Verify"]
\`\`\``);

    expect(rendered).toContain("```text");
    expect(rendered).toContain("Understand");
    expect(rendered).toContain("Implement");
    expect(rendered).toContain("Verify");
    expect(rendered).not.toContain("flowchart TD");
  });

  it("keeps invalid Mermaid as inspectable source", () => {
    const markdown = "```mermaid\nnot a diagram\n```";
    expect(renderMermaidForTerminal(markdown)).toBe(markdown);
  });
});
