#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const piBinary = path.join(root, "node_modules/.bin/pi");
const extension = path.join(root, "dist/index.js");
const artifactsRoot = path.resolve(process.env.PI_FABRIC_E2E_ARTIFACTS ?? path.join(root, ".artifacts/e2e/implement-tui"));
const runId = new Date().toISOString().replaceAll(":", "-");
const artifacts = path.join(artifactsRoot, runId);
mkdirSync(artifacts, { recursive: true });

const requests = [];
let requestNumber = 0;
let idleDurationMs = 0;
const executeFile = promisify(execFile);
const sleep = promisify(setTimeout);

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => typeof part?.text === "string" ? part.text : "").join("\n");
}

function conversation(body) {
  return Array.isArray(body.messages) ? body.messages.map((message) => textOf(message.content)).join("\n") : "";
}

function hasLatestToolResult(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  return messages.at(-1)?.role === "tool";
}

function completion(body) {
  const allText = conversation(body);
  const hasToolResult = hasLatestToolResult(body);

  if (allText.includes("Understand one requested repository change")) {
    return {
      kind: "text",
      value: JSON.stringify({
        needsInput: false,
        questions: [],
        intent: {
          outcome: "Create RESULT.md containing the requested deterministic text.",
          nonGoals: ["No other repository changes", "No delivery actions"],
          acceptance: ["RESULT.md exists with exact content"],
          risks: [],
        },
        repositoryFacts: [{ fact: "The E2E fixture is intentionally minimal.", source: "isolated fixture" }],
        track: "documentation",
        selectedSkills: [],
        reviewRequired: false,
        implementationReason: "One bounded file creation is sufficient.",
        checks: [{ label: "Exact file content", reason: "Directly proves the requested outcome." }],
        rationale: "Use the smallest workflow: write one file, read it back, and stop without delivery actions.",
      }),
    };
  }

  if (allText.includes("Implement the approved bounded repository change")) {
    if (hasToolResult) {
      return {
        kind: "text",
        value: JSON.stringify({
          status: "completed",
          summary: "Created the requested result file.",
          changedFiles: ["RESULT.md"],
          checksRun: ["Wrote RESULT.md"],
          blockers: [],
          workflowChange: "",
        }),
      };
    }
    return {
      kind: "tool",
      name: "write",
      arguments: { path: "RESULT.md", content: "IMPLEMENT_E2E_OK\n" },
    };
  }

  if (allText.includes("Independently verify the actual workspace state")) {
    if (hasToolResult) {
      return {
        kind: "text",
        value: JSON.stringify({
          ok: true,
          summary: "The requested file and exact content were verified.",
          evidence: ["RESULT.md contains exactly IMPLEMENT_E2E_OK followed by a newline."],
          failures: [],
          residualRisks: [],
        }),
      };
    }
    return { kind: "tool", name: "read", arguments: { path: "RESULT.md" } };
  }

  return { kind: "text", value: "{}" };
}

function sendChunk(response, payload) {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    response.writeHead(404).end();
    return;
  }
  let raw = "";
  for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw);
  requestNumber += 1;
  if (requestNumber > 10) {
    response.writeHead(409, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "Scripted E2E exceeded its bounded request sequence." } }));
    return;
  }
  const reply = completion(body);
  requests.push({ number: requestNumber, model: body.model, reply: reply.kind, tool: reply.name, text: conversation(body).slice(-2_000) });

  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const id = `chatcmpl-e2e-${requestNumber}`;
  const base = { id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: body.model };
  sendChunk(response, { ...base, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
  if (reply.kind === "tool") {
    sendChunk(response, {
      ...base,
      choices: [{
        index: 0,
        delta: { tool_calls: [{ index: 0, id: `call-${requestNumber}`, type: "function", function: { name: reply.name, arguments: JSON.stringify(reply.arguments) } }] },
        finish_reason: null,
      }],
    });
    sendChunk(response, { ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
  } else {
    sendChunk(response, { ...base, choices: [{ index: 0, delta: { content: reply.value }, finish_reason: null }] });
    sendChunk(response, { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
  }
  sendChunk(response, { ...base, choices: [], usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } });
  response.end("data: [DONE]\n\n");
});

async function cli(command, args, { allowFailure = false } = {}) {
  try {
    const result = await executeFile(command, args, { cwd: root, encoding: "utf8", env: process.env, timeout: 120_000 });
    const raw = result.stdout.trim();
    return raw ? JSON.parse(raw) : undefined;
  } catch (error) {
    if (allowFailure) return undefined;
    throw new Error(`${command} ${args.join(" ")} failed:\n${error.stdout ?? ""}\n${error.stderr ?? error.message}`);
  }
}

async function tty(subcommand, ...args) {
  return cli("agent-tty", [subcommand, "--json", ...args]);
}

async function waitFor(sessionId, text, timeout = 120_000) {
  const envelope = await cli("agent-tty", ["wait", "--json", "--timeout", String(timeout), "--text", text, sessionId]);
  assert.equal(envelope.ok, true, `agent-tty wait failed for ${JSON.stringify(text)}`);
  assert.equal(envelope.result.timedOut, false, `timed out waiting for ${JSON.stringify(text)}`);
}

async function pasteAndEnter(sessionId, text) {
  await tty("paste", sessionId, text);
  await tty("send-keys", sessionId, "ENTER");
}

function createFixture(baseUrl) {
  const fixture = mkdtempSync(path.join(tmpdir(), "pi-fabric-implement-e2e-"));
  const agentDir = path.join(fixture, "agent-home");
  const project = path.join(fixture, "project");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(path.join(project, "README.md"), "# Implement E2E fixture\n", "utf8");
  writeFileSync(path.join(agentDir, "models.json"), JSON.stringify({
    providers: {
      scripted: {
        baseUrl,
        api: "openai-completions",
        apiKey: "local-e2e",
        compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
        models: [{
          id: "implement-e2e",
          name: "Deterministic implement E2E",
          reasoning: false,
          input: ["text"],
          contextWindow: 200_000,
          maxTokens: 8_192,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        }],
      },
    },
  }, null, 2));
  writeFileSync(path.join(agentDir, "fabric.json"), JSON.stringify({
    configVersion: 4,
    executor: { timeoutMs: 10_000, maxTimeoutMs: 10_000 },
    approvals: { read: "allow", write: "allow", execute: "allow", network: "allow", agent: "allow" },
    agents: { runner: "pi", defaultModel: "scripted/implement-e2e", timeoutMs: 120_000 },
  }, null, 2));
  return { fixture, agentDir, project };
}

async function createPiSession(fixture) {
  const created = await cli("agent-tty", [
    "create", "--json", "--cwd", fixture.project, "--cols", "120", "--rows", "42",
    "--env", `HOME=${fixture.fixture}`,
    "--env", `PI_CODING_AGENT_DIR=${fixture.agentDir}`,
    "--env", "PI_OFFLINE=1",
    "--", piBinary,
    "--no-extensions", "--no-context-files", "--no-prompt-templates", "--no-themes",
    "--approve", "--extension", extension,
    "--provider", "scripted", "--model", "implement-e2e", "--api-key", "local-e2e",
  ]);
  return created.result.sessionId;
}

async function main() {
  assert.ok(readFileSync(extension).length > 0, "dist/index.js is missing; run bun run build first");
  await cli("agent-tty", ["version", "--json"]);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  const fixture = createFixture(`http://127.0.0.1:${address.port}/v1`);
  let sessionId;
  let completed = false;
  try {
    sessionId = await createPiSession(fixture);
    await waitFor(sessionId, "implement-e2e");
    await pasteAndEnter(sessionId, "/implement Create RESULT.md containing exactly IMPLEMENT_E2E_OK and a trailing newline");
    await waitFor(sessionId, "Which constraints matter?");
    await tty("send-keys", sessionId, "ENTER");
    await waitFor(sessionId, "Run this implementation workflow?");
    await tty("send-keys", sessionId, "Escape");
    await waitFor(sessionId, "Changed files");
    const cancelledScreen = await tty("snapshot", sessionId, "--format", "text");
    assert.match(cancelledScreen.result.text, /Changed files[\s\S]*None reported/);
    assert.equal(existsSync(path.join(fixture.project, "RESULT.md")), false);
    assert.equal(requests.length, 1, "cancellation at approval must stop before implementation");
    const cancelled = await tty("inspect", sessionId);
    writeFileSync(path.join(artifacts, "cancelled-inspect.json"), JSON.stringify(cancelled, null, 2));
    writeFileSync(path.join(artifacts, "cancelled-screen.json"), JSON.stringify(cancelledScreen, null, 2));
    writeFileSync(path.join(artifacts, "cancelled-model-requests.json"), JSON.stringify(requests, null, 2));
    await cli("agent-tty", ["record", "export", "--json", "--format", "asciicast", "--out", path.join(artifacts, "implement-cancelled.cast"), sessionId]);
    await cli("agent-tty", ["destroy", "--json", sessionId]);
    requests.length = 0;

    sessionId = await createPiSession(fixture);
    await waitFor(sessionId, "implement-e2e");
    await pasteAndEnter(sessionId, "/implement Create RESULT.md containing exactly IMPLEMENT_E2E_OK and a trailing newline");
    await waitFor(sessionId, "Which constraints matter?");
    await tty("send-keys", sessionId, "ENTER");
    await waitFor(sessionId, "Run this implementation workflow?");
    const idleStartedAt = Date.now();
    await sleep(11_000);
    idleDurationMs = Date.now() - idleStartedAt;
    assert.ok(idleDurationMs >= 11_000, "approval dialog did not remain idle past the active deadline");
    await tty("send-keys", sessionId, "ENTER");
    await waitFor(sessionId, "✓ Fabric Implement", 180_000);

    assert.equal(readFileSync(path.join(fixture.project, "RESULT.md"), "utf8"), "IMPLEMENT_E2E_OK\n");
    assert.deepEqual(requests.map((entry) => [entry.reply, entry.tool ?? null]), [
      ["text", null],
      ["tool", "write"],
      ["text", null],
      ["tool", "read"],
      ["text", null],
    ]);

    completed = true;
    console.log(JSON.stringify({ ok: true, sessionId, artifacts, requests: requests.length }, null, 2));
  } finally {
    const resultPath = path.join(fixture.project, "RESULT.md");
    const result = existsSync(resultPath) ? readFileSync(resultPath, "utf8") : null;
    writeFileSync(path.join(artifacts, "model-requests.json"), JSON.stringify(requests, null, 2));
    writeFileSync(path.join(artifacts, "e2e-summary.json"), JSON.stringify({
      ok: completed,
      activeDeadlineMs: 10_000,
      idleDurationMs,
      requestCount: requests.length,
      result,
    }, null, 2));
    if (result !== null) writeFileSync(path.join(artifacts, "result.txt"), result);
    if (sessionId) {
      const inspected = await cli("agent-tty", ["inspect", "--json", sessionId], { allowFailure: true });
      if (inspected) writeFileSync(path.join(artifacts, "final-inspect.json"), JSON.stringify(inspected, null, 2));
      await cli("agent-tty", ["record", "export", "--json", "--format", "asciicast", "--out", path.join(artifacts, "implement-tui.cast"), sessionId], { allowFailure: true });
      await cli("agent-tty", ["destroy", "--json", sessionId], { allowFailure: true });
    }
    server.close();
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
}

main().catch((error) => {
  server.close();
  console.error(error?.stack ?? String(error));
  process.exitCode = 1;
});
