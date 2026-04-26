import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { binaryAvailable, runCommand } from "./process.mjs";
import { generateJobId, resolveJobFile, resolveJobLogFile, upsertJob, writeJobFile } from "./state.mjs";
import { appendLogLine, getCurrentSessionId, nowIso } from "./tracked-jobs.mjs";

const MAX_PROGRESS_LINES = 12;

function compactText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function summarize(text, limit = 150) {
  const normalized = compactText(text);
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 3)}...`;
}

function appendProgress(state, line) {
  const normalized = compactText(line);
  if (!normalized) {
    return;
  }
  state.progressPreview.push(normalized);
  state.progressPreview = state.progressPreview.slice(-MAX_PROGRESS_LINES);
}

export function buildArgs(opts = {}) {
  const args = ["-p", opts.prompt ?? "", "--output-format", "stream-json", "--workspace", opts.workspace];
  args.push("--trust");
  if (opts.force) {
    args.push("--force");
  }
  if (opts.resume) {
    args.push("--resume", opts.resume);
  } else if (opts.continue) {
    args.push("--continue");
  }
  if (opts.model) {
    args.push("--model", opts.model);
  }
  if (opts.mode) {
    args.push("--mode", opts.mode);
  }
  if (opts.sandbox) {
    args.push("--sandbox", opts.sandbox);
  }
  return args;
}

export function createCursorStreamParser() {
  const state = {
    threadId: null,
    status: "running",
    phase: "starting",
    progressPreview: [],
    finalText: "",
    durationMs: null,
    errorMessage: null,
    events: []
  };

  function applyEvent(event) {
    if (!event || typeof event !== "object") {
      return state;
    }

    state.events.push(event);
    const type = event.type;
    const subtype = event.subtype;

    // TODO: Verify exact cursor-agent stream-json field names by running cursor-agent locally.
    if (type === "system" && subtype === "init") {
      state.threadId = firstString(event.thread_id, event.threadId, event.session_id, event.sessionId);
      state.phase = "starting";
      appendProgress(state, state.threadId ? `Thread ready: ${state.threadId}` : "Thread ready");
      return state;
    }

    if (type === "assistant") {
      const contentParts = Array.isArray(event.message?.content) ? event.message.content : [];
      const text = contentParts
        .map((part) => (typeof part?.text === "string" ? part.text : ""))
        .filter(Boolean)
        .join("")
        || firstString(event.text, event.delta, event.message);
      appendProgress(state, text);
      state.phase = "running";
      return state;
    }

    if (type === "tool_call") {
      const name = firstString(event.name, event.tool_name, event.toolName, event.function?.name, event.tool?.name, "unknown");
      appendProgress(state, `Running tool: ${name}`);
      state.phase = /edit|write|patch|apply/i.test(name) ? "editing" : "running";
      return state;
    }

    if (type === "result") {
      state.durationMs = Number.isFinite(event.duration_ms) ? event.duration_ms : Number.isFinite(event.durationMs) ? event.durationMs : null;
      const isError = event.is_error === true || subtype === "error" || subtype === "failed";
      if (isError) {
        state.errorMessage = firstString(event.error, event.result, event.message, event.stderr, "cursor-agent failed");
        state.status = "failed";
        state.phase = "failed";
        return state;
      }
      state.finalText = firstString(event.result, event.text, event.message, event.content, event.output, event.final);
      state.status = "completed";
      state.phase = "done";
      return state;
    }

    return state;
  }

  return { state, applyEvent };
}

export function parseStreamLine(line, parser = createCursorStreamParser()) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed) {
    return parser.state;
  }
  const event = JSON.parse(trimmed);
  return parser.applyEvent(event);
}

function splitLines(buffer) {
  return buffer.split(/\r?\n/);
}

function spawnAgent(opts) {
  const args = buildArgs(opts);
  const child = spawn("cursor-agent", args, {
    cwd: opts.workspace,
    env: opts.env ?? process.env,
    detached: Boolean(opts.detached),
    stdio: ["ignore", "pipe", "pipe"]
  });
  return { child, args };
}

export async function runForeground(opts) {
  const parser = createCursorStreamParser();
  const { child } = spawnAgent({ ...opts, detached: false });
  let stdoutRemainder = "";
  let stderr = "";

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  child.stdout.on("data", (chunk) => {
    const lines = splitLines(stdoutRemainder + chunk);
    stdoutRemainder = lines.pop() ?? "";
    for (const line of lines) {
      try {
        parseStreamLine(line, parser);
      } catch {
        appendProgress(parser.state, line);
      }
    }
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const exit = await new Promise((resolve) => {
    child.on("error", (error) => resolve({ code: 1, error }));
    child.on("close", (code, signal) => resolve({ code: code ?? 1, signal }));
  });

  if (stdoutRemainder.trim()) {
    try {
      parseStreamLine(stdoutRemainder, parser);
    } catch {
      appendProgress(parser.state, stdoutRemainder);
    }
  }

  const exitCode = exit.code ?? 1;
  const failureMessage = exit.error?.message ?? stderr.trim();
  return {
    result: {
      rawOutput: parser.state.finalText,
      failureMessage,
      progressPreview: parser.state.progressPreview
    },
    threadId: parser.state.threadId,
    durationMs: parser.state.durationMs,
    exitCode,
    status: exitCode === 0 && parser.state.status === "completed" ? "completed" : "failed"
  };
}

export function runBackground(opts, jobMeta = {}) {
  const workspaceRoot = opts.workspace;
  const jobId = jobMeta.id ?? generateJobId("task");
  const logFile = resolveJobLogFile(workspaceRoot, jobId);
  const resultFile = resolveJobFile(workspaceRoot, jobId);
  const startedAt = nowIso();
  const baseJob = {
    id: jobId,
    kind: "task",
    kindLabel: "cursor",
    status: "running",
    phase: "starting",
    prompt: opts.prompt,
    model: opts.model ?? null,
    mode: opts.mode ?? null,
    sandbox: opts.sandbox ?? null,
    foreground: false,
    force: Boolean(opts.force),
    startedAt,
    logFile,
    resultFile,
    sessionId: getCurrentSessionId(),
    summary: jobMeta.summary ?? summarize(opts.prompt)
  };

  upsertJob(workspaceRoot, baseJob);
  writeJobFile(workspaceRoot, jobId, baseJob);
  appendLogLine(logFile, "Starting Cursor");

  const child = spawn(process.execPath, [new URL("../background-runner.mjs", import.meta.url).pathname, JSON.stringify({ opts, job: baseJob })], {
    cwd: workspaceRoot,
    detached: true,
    stdio: "ignore",
    env: process.env
  });
  child.unref();

  upsertJob(workspaceRoot, { id: jobId, pid: child.pid });
  return { ...baseJob, pid: child.pid };
}

export async function runBackgroundChild(opts, job) {
  const parser = createCursorStreamParser();
  const { child } = spawnAgent({ ...opts, detached: true });
  let stdoutRemainder = "";
  let stderr = "";

  upsertJob(opts.workspace, { id: job.id, pid: child.pid, status: "running" });

  function persistProgress() {
    upsertJob(opts.workspace, {
      id: job.id,
      status: parser.state.status === "failed" ? "failed" : "running",
      threadId: parser.state.threadId,
      phase: parser.state.phase,
      summary: parser.state.progressPreview.at(-1) ?? job.summary
    });
  }

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    const lines = splitLines(stdoutRemainder + chunk);
    stdoutRemainder = lines.pop() ?? "";
    for (const line of lines) {
      try {
        parseStreamLine(line, parser);
      } catch {
        appendProgress(parser.state, line);
      }
      appendLogLine(job.logFile, parser.state.progressPreview.at(-1) ?? line);
      persistProgress();
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    appendLogLine(job.logFile, chunk);
  });

  const exit = await new Promise((resolve) => {
    child.on("error", (error) => resolve({ code: 1, error }));
    child.on("close", (code, signal) => resolve({ code: code ?? 1, signal }));
  });

  if (stdoutRemainder.trim()) {
    try {
      parseStreamLine(stdoutRemainder, parser);
    } catch {
      appendProgress(parser.state, stdoutRemainder);
    }
  }

  const exitCode = exit.code ?? 1;
  const status = exitCode === 0 && parser.state.status !== "failed" ? "completed" : "failed";
  const rawOutput = parser.state.finalText;
  const errorMessage = exit.error?.message ?? parser.state.errorMessage ?? stderr.trim() ?? null;
  const completedAt = nowIso();
  const finalJob = {
    ...job,
    status,
    phase: status === "completed" ? "done" : "failed",
    threadId: parser.state.threadId,
    completedAt,
    exitCode,
    durationMs: parser.state.durationMs,
    summary: summarize(rawOutput || errorMessage || job.summary),
    errorMessage: status === "failed" ? errorMessage : null
  };
  const payload = {
    ...finalJob,
    result: {
      rawOutput,
      failureMessage: errorMessage,
      progressPreview: parser.state.progressPreview
    }
  };

  writeJobFile(opts.workspace, job.id, payload);
  upsertJob(opts.workspace, finalJob);
  appendLogLine(job.logFile, status === "completed" ? "Cursor completed" : `Cursor failed: ${errorMessage ?? `exit ${exitCode}`}`);
}

export async function getRuntimeStatus(env = process.env, cwd = process.cwd()) {
  const cursor = binaryAvailable("cursor-agent", ["--version"], { cwd, env });
  let auth = { loggedIn: false, detail: "not checked" };

  if (!cursor.available) {
    auth = { loggedIn: false, detail: "cursor-agent not available" };
  } else if (env.CURSOR_API_KEY) {
    auth = { loggedIn: true, detail: "CURSOR_API_KEY is set" };
  } else {
    const result = runCommand("cursor-agent", ["ls"], { cwd, env, maxBuffer: 1024 * 1024 });
    auth =
      result.status === 0
        ? { loggedIn: true, detail: "cursor-agent ls succeeded" }
        : { loggedIn: false, detail: result.stderr.trim() || result.stdout.trim() || "set CURSOR_API_KEY or run cursor-agent interactively" };
  }

  return {
    ready: cursor.available && auth.loggedIn,
    cursor,
    auth
  };
}

export function readBackgroundPayload(raw) {
  const parsed = JSON.parse(raw);
  return {
    opts: parsed.opts,
    job: parsed.job
  };
}
