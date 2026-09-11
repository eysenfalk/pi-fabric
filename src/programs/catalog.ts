import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FabricKernel } from "../runtime/kernel.js";

const FABRIC_PROGRAM_MANIFEST_VERSION = 1 as const;
const FABRIC_PROGRAM_MAX_MANIFEST_BYTES = 64 * 1024;
const FABRIC_PROGRAM_MAX_SOURCE_BYTES = 512 * 1024;
const FABRIC_PROGRAM_MAX_COUNT = 128;

export type FabricProgramScope = "builtin" | "global" | "project";

export interface FabricProgramParameter {
  type: "string";
  description?: string;
  required?: boolean;
  default?: string;
}

export interface FabricProgramDescriptor {
  name: string;
  scope: FabricProgramScope;
  description?: string;
  kernel: FabricKernel;
  parameters: Record<string, FabricProgramParameter>;
}

export interface FabricResolvedProgram extends FabricProgramDescriptor {
  code: string;
  payloads: Record<string, string>;
  digest: string;
}

export interface FabricProgramDiscovery {
  programs: FabricProgramDescriptor[];
  errors: string[];
}

interface FabricProgramRoots {
  builtin: string;
  global: string;
  project: string;
}

interface FabricProgramManifestV1 {
  version: typeof FABRIC_PROGRAM_MANIFEST_VERSION;
  description?: string;
  kernel: FabricKernel;
  source: string;
  parameters: Record<string, FabricProgramParameter>;
}

interface FabricProgramContext {
  cwd: string;
  agentDir: string;
  projectTrusted: boolean;
  managedHost?: boolean;
  /** Test/embedding override; normal Pi sessions resolve the package-owned root. */
  builtinRoot?: string;
}

const PROGRAM_NAME_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/;
const PARAMETER_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MANIFEST_KEYS = new Set(["version", "description", "kernel", "source", "parameters"]);
const PARAMETER_KEYS = new Set(["type", "description", "required", "default"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const assertKnownKeys = (
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void => {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new Error(`${label} has unknown field${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`);
};

const within = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
};

const readBounded = async (file: string, maximum: number, label: string): Promise<string> => {
  const metadata = await stat(file);
  if (!metadata.isFile()) throw new Error(`${label} is not a file`);
  if (metadata.size > maximum) throw new Error(`${label} exceeds ${maximum} bytes`);
  return readFile(file, "utf8");
};

const parseParameter = (name: string, value: unknown): FabricProgramParameter => {
  if (!PARAMETER_NAME.test(name)) {
    throw new Error(`Program parameter ${JSON.stringify(name)} must be a portable identifier`);
  }
  if (!isRecord(value)) throw new Error(`Program parameter ${name} must be an object`);
  assertKnownKeys(value, PARAMETER_KEYS, `Program parameter ${name}`);
  if (value.type !== "string") throw new Error(`Program parameter ${name}.type must be \"string\"`);
  if (value.description !== undefined && typeof value.description !== "string") {
    throw new Error(`Program parameter ${name}.description must be a string`);
  }
  if (value.required !== undefined && typeof value.required !== "boolean") {
    throw new Error(`Program parameter ${name}.required must be a boolean`);
  }
  if (value.default !== undefined && typeof value.default !== "string") {
    throw new Error(`Program parameter ${name}.default must be a string`);
  }
  return {
    type: "string",
    ...(value.description !== undefined ? { description: value.description } : {}),
    ...(value.required !== undefined ? { required: value.required } : {}),
    ...(value.default !== undefined ? { default: value.default } : {}),
  };
};

const parseManifest = (text: string, label: string): FabricProgramManifestV1 => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(value)) throw new Error(`${label} must contain an object`);
  assertKnownKeys(value, MANIFEST_KEYS, label);
  if (value.version !== FABRIC_PROGRAM_MANIFEST_VERSION) {
    throw new Error(`${label}.version must be ${FABRIC_PROGRAM_MANIFEST_VERSION}`);
  }
  if (value.kernel !== "typescript" && value.kernel !== "python") {
    throw new Error(`${label}.kernel must be \"typescript\" or \"python\"`);
  }
  if (typeof value.source !== "string" || value.source.trim() === "" || path.isAbsolute(value.source)) {
    throw new Error(`${label}.source must be a non-empty relative path`);
  }
  if (value.description !== undefined && typeof value.description !== "string") {
    throw new Error(`${label}.description must be a string`);
  }
  if (value.parameters !== undefined && !isRecord(value.parameters)) {
    throw new Error(`${label}.parameters must be an object`);
  }
  const parameters = Object.fromEntries(
    Object.entries(value.parameters ?? {}).map(([name, parameter]) => [name, parseParameter(name, parameter)]),
  );
  return {
    version: FABRIC_PROGRAM_MANIFEST_VERSION,
    kernel: value.kernel,
    source: value.source,
    parameters,
    ...(value.description !== undefined ? { description: value.description } : {}),
  };
};

const defaultBuiltinRoot = (): string => {
  // Source tests resolve from src/programs/catalog.ts; the built extension resolves
  // from dist/index.js. Select the first candidate that contains the bundled Program.
  const candidates = [
    fileURLToPath(new URL("../programs", import.meta.url)),
    fileURLToPath(new URL("../../programs", import.meta.url)),
  ];
  return candidates.find((candidate) => existsSync(path.join(candidate, "implement.json")))
    ?? candidates[0]!;
};

const fabricProgramRoots = (context: FabricProgramContext): FabricProgramRoots => ({
  builtin: context.builtinRoot ?? defaultBuiltinRoot(),
  global: path.join(context.agentDir, "fabric", "programs"),
  project: path.join(context.cwd, ".pi", "fabric", "programs"),
});

const parseProgramName = (name: string): { scope: FabricProgramScope; id: string } => {
  const [scope, ...segments] = name.split("/");
  if ((scope !== "builtin" && scope !== "global" && scope !== "project") || segments.length === 0 || segments.some((segment) => !PROGRAM_NAME_SEGMENT.test(segment))) {
    throw new Error(`Program name must be scope-qualified as builtin/<name>, global/<name>, or project/<name>`);
  }
  return { scope, id: segments.join("/") };
};

const readDefinition = async (
  name: string,
  context: FabricProgramContext,
): Promise<{ descriptor: FabricProgramDescriptor; code: string }> => {
  const { scope, id } = parseProgramName(name);
  if (context.managedHost && scope !== "builtin") {
    throw new Error("Local Fabric programs are unavailable in managed hosts");
  }
  if (scope === "project" && !context.projectTrusted) {
    throw new Error("Project Fabric programs require a trusted project");
  }
  const root = fabricProgramRoots(context)[scope];
  const manifestPath = path.join(root, `${id}.json`);
  let canonicalRoot: string;
  let canonicalManifest: string;
  try {
    [canonicalRoot, canonicalManifest] = await Promise.all([realpath(root), realpath(manifestPath)]);
  } catch {
    throw new Error(`Fabric program not found: ${name}`);
  }
  if (!within(canonicalRoot, canonicalManifest)) throw new Error(`Fabric program manifest escapes its ${scope} root: ${name}`);
  const manifest = parseManifest(
    await readBounded(canonicalManifest, FABRIC_PROGRAM_MAX_MANIFEST_BYTES, `Manifest for ${name}`),
    `Manifest for ${name}`,
  );
  const lexicalSource = path.resolve(path.dirname(canonicalManifest), manifest.source);
  let canonicalSource: string;
  try {
    canonicalSource = await realpath(lexicalSource);
  } catch {
    throw new Error(`Fabric program source not found: ${name}`);
  }
  if (!within(canonicalRoot, canonicalSource)) throw new Error(`Fabric program source escapes its ${scope} root: ${name}`);
  const expectedExtension = manifest.kernel === "typescript" ? ".ts" : ".py";
  if (path.extname(canonicalSource) !== expectedExtension) {
    throw new Error(`Fabric program ${name} must use a ${expectedExtension} source for the ${manifest.kernel} kernel`);
  }
  const code = await readBounded(canonicalSource, FABRIC_PROGRAM_MAX_SOURCE_BYTES, `Source for ${name}`);
  return {
    descriptor: {
      name,
      scope,
      kernel: manifest.kernel,
      parameters: manifest.parameters,
      ...(manifest.description !== undefined ? { description: manifest.description } : {}),
    },
    code,
  };
};

const resolvePayloads = (
  descriptor: FabricProgramDescriptor,
  supplied: Record<string, string> | undefined,
): Record<string, string> => {
  const payloads = supplied ?? {};
  const unknown = Object.keys(payloads).filter((name) => !Object.hasOwn(descriptor.parameters, name));
  if (unknown.length > 0) throw new Error(`Unknown payload${unknown.length === 1 ? "" : "s"} for ${descriptor.name}: ${unknown.join(", ")}`);
  const resolved: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [name, parameter] of Object.entries(descriptor.parameters)) {
    if (Object.hasOwn(payloads, name)) resolved[name] = payloads[name]!;
    else if (parameter.default !== undefined) resolved[name] = parameter.default;
    else if (parameter.required) throw new Error(`Missing required payload for ${descriptor.name}: ${name}`);
  }
  return resolved;
};

export const resolveFabricProgram = async (
  name: string,
  payloads: Record<string, string> | undefined,
  expectedKernel: FabricKernel,
  context: FabricProgramContext,
): Promise<FabricResolvedProgram> => {
  const { descriptor, code } = await readDefinition(name, context);
  if (descriptor.kernel !== expectedKernel) {
    throw new Error(`Fabric program ${name} requires the ${descriptor.kernel} kernel; current kernel is ${expectedKernel}`);
  }
  return {
    ...descriptor,
    code,
    payloads: resolvePayloads(descriptor, payloads),
    digest: createHash("sha256").update(code).digest("hex"),
  };
};

const manifestIds = async (root: string): Promise<string[]> => {
  const ids: string[] = [];
  const walk = async (directory: string, prefix = ""): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative);
      else if (entry.isFile() && entry.name.endsWith(".json")) {
        ids.push(relative.slice(0, -".json".length));
        if (ids.length > FABRIC_PROGRAM_MAX_COUNT) throw new Error(`Fabric program catalog exceeds ${FABRIC_PROGRAM_MAX_COUNT} manifests`);
      }
    }
  };
  await walk(root);
  return ids;
};

export const discoverFabricPrograms = async (context: FabricProgramContext): Promise<FabricProgramDiscovery> => {
  const roots = fabricProgramRoots(context);
  const localScopes: FabricProgramScope[] = context.projectTrusted
    ? ["global", "project"]
    : ["global"];
  const scopes: FabricProgramScope[] = context.managedHost
    ? ["builtin"]
    : ["builtin", ...localScopes];
  const programs: FabricProgramDescriptor[] = [];
  const errors: string[] = [];
  for (const scope of scopes) {
    let ids: string[];
    try {
      ids = await manifestIds(roots[scope]);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    for (const id of ids) {
      const name = `${scope}/${id}`;
      try {
        programs.push((await readDefinition(name, context)).descriptor);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }
  return { programs, errors };
};
