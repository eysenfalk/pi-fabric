import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  discoverFabricPrograms,
  resolveFabricProgram,
} from "../src/programs/catalog.js";

const roots: string[] = [];
const fixture = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fabric-programs-"));
  roots.push(root);
  const cwd = path.join(root, "project");
  const agentDir = path.join(root, "agent");
  await Promise.all([mkdir(cwd, { recursive: true }), mkdir(agentDir, { recursive: true })]);
  return { root, cwd, agentDir, projectTrusted: true };
};

const addProgram = async (
  base: string,
  name: string,
  manifest: Record<string, unknown>,
  source = "return π.request;",
) => {
  const manifestPath = path.join(base, `${name}.json`);
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await Promise.all([
    writeFile(manifestPath, JSON.stringify(manifest)),
    writeFile(path.join(path.dirname(manifestPath), String(manifest.source)), source),
  ]);
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("reusable Fabric programs", () => {
  it("resolves a trusted project program, validates payloads, applies defaults, and pins a digest", async () => {
    const context = await fixture();
    const base = path.join(context.cwd, ".pi", "fabric", "programs");
    await addProgram(base, "review", {
      version: 1,
      description: "Run the standard review",
      kernel: "typescript",
      source: "review.ts",
      parameters: {
        request: { type: "string", required: true },
        preset: { type: "string", default: "standard" },
      },
    });

    const program = await resolveFabricProgram(
      "project/review",
      { request: "Audit auth" },
      "typescript",
      context,
    );

    expect(program).toMatchObject({
      name: "project/review",
      scope: "project",
      description: "Run the standard review",
      kernel: "typescript",
      code: "return π.request;",
      payloads: { request: "Audit auth", preset: "standard" },
    });
    expect(program.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects missing and unknown payloads before execution", async () => {
    const context = await fixture();
    const base = path.join(context.cwd, ".pi", "fabric", "programs");
    await addProgram(base, "review", {
      version: 1,
      kernel: "typescript",
      source: "review.ts",
      parameters: { request: { type: "string", required: true } },
    });

    await expect(resolveFabricProgram("project/review", {}, "typescript", context))
      .rejects.toThrow("Missing required payload");
    await expect(resolveFabricProgram(
      "project/review",
      { request: "ok", surprise: "no" },
      "typescript",
      context,
    )).rejects.toThrow("Unknown payload");
  });

  it("handles prototype-shaped payload names as own properties only", async () => {
    const context = await fixture();
    const base = path.join(context.cwd, ".pi", "fabric", "programs");
    await addProgram(base, "prototype", {
      version: 1,
      kernel: "typescript",
      source: "prototype.ts",
      parameters: Object.fromEntries([["toString", { type: "string", required: true }]]),
    });

    await expect(resolveFabricProgram("project/prototype", {}, "typescript", context))
      .rejects.toThrow("Missing required payload");
    await expect(resolveFabricProgram(
      "project/prototype",
      JSON.parse('{"toString":"ok","__proto__":"no"}') as Record<string, string>,
      "typescript",
      context,
    )).rejects.toThrow("Unknown payload for project/prototype: __proto__");
    await expect(resolveFabricProgram(
      "project/prototype",
      { toString: "ok" },
      "typescript",
      context,
    )).resolves.toMatchObject({ payloads: { toString: "ok" } });
  });

  it("requires explicit scope and project trust while keeping global programs available", async () => {
    const context = await fixture();
    const manifest = {
      version: 1,
      kernel: "typescript",
      source: "probe.ts",
      parameters: {},
    };
    await addProgram(path.join(context.cwd, ".pi", "fabric", "programs"), "probe", manifest, "return 1;");
    await addProgram(path.join(context.agentDir, "fabric", "programs"), "probe", manifest, "return 2;");

    await expect(resolveFabricProgram("probe", {}, "typescript", context))
      .rejects.toThrow("scope-qualified");
    await expect(resolveFabricProgram(
      "project/probe",
      {},
      "typescript",
      { ...context, projectTrusted: false },
    )).rejects.toThrow("trusted project");
    await expect(resolveFabricProgram(
      "global/probe",
      {},
      "typescript",
      { ...context, projectTrusted: false },
    )).resolves.toMatchObject({ code: "return 2;" });
  });

  it("rejects kernel mismatches and sources outside the program root", async () => {
    const context = await fixture();
    const base = path.join(context.cwd, ".pi", "fabric", "programs");
    await addProgram(base, "python-only", {
      version: 1,
      kernel: "python",
      source: "python-only.py",
      parameters: {},
    }, "return 1");
    await expect(resolveFabricProgram("project/python-only", {}, "typescript", context))
      .rejects.toThrow("requires the python kernel");

    await mkdir(base, { recursive: true });
    const absoluteInside = path.join(base, "absolute.ts");
    await writeFile(absoluteInside, "return 'inside';");
    await writeFile(path.join(base, "absolute.json"), JSON.stringify({
      version: 1,
      kernel: "typescript",
      source: absoluteInside,
      parameters: {},
    }));
    await expect(resolveFabricProgram("project/absolute", {}, "typescript", context))
      .rejects.toThrow("relative path");

    const outside = path.join(context.root, "outside.ts");
    await writeFile(outside, "return 'outside';");
    await writeFile(path.join(base, "escape.json"), JSON.stringify({
      version: 1,
      kernel: "typescript",
      source: path.relative(base, outside),
      parameters: {},
    }));
    await expect(resolveFabricProgram("project/escape", {}, "typescript", context))
      .rejects.toThrow("escapes its project root");
  });

  it("rejects oversized source bodies before execution", async () => {
    const context = await fixture();
    const base = path.join(context.cwd, ".pi", "fabric", "programs");
    await addProgram(base, "oversized", {
      version: 1,
      kernel: "typescript",
      source: "oversized.ts",
      parameters: {},
    }, "x".repeat(512 * 1024 + 1));

    await expect(resolveFabricProgram("project/oversized", {}, "typescript", context))
      .rejects.toThrow("exceeds 524288 bytes");
  });

  it("rejects symlink escapes and local loading in managed hosts", async () => {
    const context = await fixture();
    const base = path.join(context.cwd, ".pi", "fabric", "programs");
    const outside = path.join(context.root, "outside.ts");
    await Promise.all([mkdir(base, { recursive: true }), writeFile(outside, "return 1;")]);
    await symlink(outside, path.join(base, "linked.ts"));
    await writeFile(path.join(base, "linked.json"), JSON.stringify({
      version: 1,
      kernel: "typescript",
      source: "linked.ts",
      parameters: {},
    }));

    await expect(resolveFabricProgram("project/linked", {}, "typescript", context))
      .rejects.toThrow("escapes its project root");
    await expect(resolveFabricProgram(
      "global/anything",
      {},
      "typescript",
      { ...context, managedHost: true },
    )).rejects.toThrow("unavailable in managed hosts");
  });

  it("discovers valid programs and reports malformed manifests without exposing project programs when untrusted", async () => {
    const context = await fixture();
    const globalBase = path.join(context.agentDir, "fabric", "programs");
    const projectBase = path.join(context.cwd, ".pi", "fabric", "programs");
    const manifest = { version: 1, kernel: "typescript", source: "probe.ts", parameters: {} };
    await addProgram(globalBase, "nested/probe", manifest, "return 1;");
    await addProgram(projectBase, "project-probe", manifest, "return 2;");
    await writeFile(path.join(globalBase, "broken.json"), "{");

    const trusted = await discoverFabricPrograms(context);
    expect(trusted.programs.map((program) => program.name)).toEqual([
      "global/nested/probe",
      "project/project-probe",
    ]);
    expect(trusted.errors).toHaveLength(1);

    const untrusted = await discoverFabricPrograms({ ...context, projectTrusted: false });
    expect(untrusted.programs.map((program) => program.name)).toEqual(["global/nested/probe"]);
  });
});
