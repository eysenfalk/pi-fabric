# Reusable Fabric programs

Reusable programs preserve proven orchestration as named code while keeping Fabric's existing runtime as the only execution engine. A named program is resolved to one source body, validated, pinned by digest for that invocation, and passed to the same `FabricExecutionService` used by inline `fabric_exec` code.

## Program locations

Programs are explicitly scope-qualified:

| Scope | Manifest root | Invocation name |
| --- | --- | --- |
| Global | `~/.pi/agent/fabric/programs/` | `global/<name>` |
| Project | `.pi/fabric/programs/` | `project/<name>` |

Project programs load only after Pi trusts the project. Local programs are unavailable in managed hosts, whose capability set remains closed-world. Explicit scopes prevent project files from silently shadowing global programs.

A program consists of a JSON manifest and a source file. For `project/review`, create:

```text
.pi/fabric/programs/
├── review.json
└── review.ts
```

`review.json`:

```json
{
  "version": 1,
  "description": "Run the standard implementation review",
  "kernel": "typescript",
  "source": "review.ts",
  "parameters": {
    "request": {
      "type": "string",
      "description": "The change to review",
      "required": true
    },
    "preset": {
      "type": "string",
      "default": "standard"
    }
  }
}
```

`review.ts` is an ordinary TypeScript Fabric function body:

```ts
const findings = await agent(
  `Review this request with the ${π.preset} preset:\n\n${π.request}`,
  { label: "review" },
);
return findings;
```

For the Python kernel, set `"kernel": "python"` and use a `.py` source containing an ordinary Python Fabric function body. A program's declared kernel must match the current configured kernel; Fabric never switches kernels or falls back for one invocation.

## Invocation

Pass exactly one source to `fabric_exec`: inline `code` or a named `program`.

```json
{
  "program": "project/review",
  "payloads": {
    "request": "Add GitHub OAuth"
  },
  "display": {
    "name": "Review OAuth implementation"
  }
}
```

Manifest defaults are applied before execution. Missing required payloads and unknown payload names fail before the body runs. Parameters are deliberately string-valued in version 1, matching Fabric's existing `payloads`/`π` transport and keeping the model-facing tool schema flat.

Run `/fabric programs` to list available programs and their parameter contracts. Add a search term to filter the list, for example `/fabric programs review`.

## Security and lifecycle

Program manifests and sources are read as data, never imported into the host. Fabric rejects malformed manifests, unknown fields, oversized files, wrong source extensions, traversal, and symlink escapes. The resolved source bytes receive a SHA-256 digest that is persisted with the tool result, so history identifies the exact body even if the file later changes.

After resolution, execution is identical to inline code. Programs receive no additional authority: the configured sandbox, committed capability view, provider registry, approvals, Schema mode, cancellation, deadlines, output limits, and agent/token budgets remain in force.

## Version 1 boundary

Version 1 supports top-level named invocation, normal control flow inside a program, string parameter contracts, defaults, global/project scopes, and discovery through `/fabric programs`.

It intentionally does **not** add per-program slash commands or a guest `programs.run()` API. A possible composition capability is retained as a non-normative [Idea document](ideas/program-composition.md). If that direction is promoted later, it must preserve the outer execution frame, capability view, budgets, trace, and handoff boundary. Independent recursive `FabricExecutionService.execute()` lifecycles would violate that boundary.
