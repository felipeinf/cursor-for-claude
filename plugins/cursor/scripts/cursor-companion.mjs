#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { parseArgs, splitRawArgumentString } from "./lib/args.mjs";
import { readStdinIfPiped } from "./lib/fs.mjs";
import { binaryAvailable, terminateProcessTree } from "./lib/process.mjs";
import { getResumeCandidate, buildSingleJobSnapshot, buildStatusSnapshot, readStoredJob, resolveCancelableJob, resolveResultJob } from "./lib/job-control.mjs";
import { runBackground, runForeground, getRuntimeStatus } from "./lib/cursor.mjs";
import { generateJobId, upsertJob, writeJobFile, resolveJobLogFile } from "./lib/state.mjs";
import { nowIso, SESSION_ID_ENV } from "./lib/tracked-jobs.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";
import { renderCancelReport, renderJobStatusReport, renderSetupReport, renderStatusReport, renderStoredJobResult, renderTaskResult } from "./lib/render.mjs";

function printUsage() {
  console.log(
    [
      "Usage:",
      "  node scripts/cursor-companion.mjs task [--background|--wait] [--continue|--fresh|--resume <id>] [--model <name>] [--mode plan|ask] [--read-only] [--sandbox enabled|disabled] [prompt]",
      "  node scripts/cursor-companion.mjs status [job-id] [--all] [--json]",
      "  node scripts/cursor-companion.mjs result [job-id] [--json]",
      "  node scripts/cursor-companion.mjs cancel [job-id] [--json]",
      "  node scripts/cursor-companion.mjs setup [--json]",
      "  node scripts/cursor-companion.mjs task-resume-candidate [--json]"
    ].join("\n")
  );
}

function output(value, asJson = false) {
  if (asJson) {
    console.log(JSON.stringify(value, null, 2));
  } else {
    process.stdout.write(value);
  }
}

function normalizeArgv(argv) {
  if (argv.length === 1) {
    const [raw] = argv;
    return raw?.trim() ? splitRawArgumentString(raw) : [];
  }
  return argv;
}

function parseCommandInput(argv, config = {}) {
  return parseArgs(normalizeArgv(argv), {
    ...config,
    aliasMap: {
      C: "cwd",
      ...(config.aliasMap ?? {})
    }
  });
}

function resolveCommandCwd(options = {}) {
  return options.cwd ? path.resolve(process.cwd(), options.cwd) : process.cwd();
}

function readPrompt(cwd, options, positionals) {
  if (options["prompt-file"]) {
    return fs.readFileSync(path.resolve(cwd, options["prompt-file"]), "utf8");
  }
  return positionals.join(" ") || readStdinIfPiped();
}

function summarize(text, limit = 150) {
  const normalized = String(text ?? "").trim().replace(/\s+/g, " ");
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 3)}...`;
}

function ensureCursorAvailable(cwd) {
  const availability = binaryAvailable("cursor-agent", ["--version"], { cwd });
  if (!availability.available) {
    throw new Error("cursor-agent is not installed or is not on PATH. Run /cursor:setup.");
  }
}

async function buildSetupReport(cwd, actionsTaken = []) {
  const node = binaryAvailable("node", ["--version"], { cwd });
  const runtime = await getRuntimeStatus(process.env, cwd);
  const nextSteps = [];

  if (!runtime.cursor.available) {
    nextSteps.push("Install Cursor CLI with `curl https://cursor.com/install -fsS | bash`.");
  }
  if (runtime.cursor.available && !runtime.auth.loggedIn) {
    nextSteps.push("Set `CURSOR_API_KEY` in the environment, or run `!cursor-agent` interactively to log in.");
  }

  return {
    ready: node.available && runtime.ready,
    node,
    cursor: runtime.cursor,
    auth: runtime.auth,
    actionsTaken,
    nextSteps
  };
}

async function handleSetup(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });
  const cwd = resolveCommandCwd(options);
  const report = await buildSetupReport(cwd);
  output(options.json ? report : renderSetupReport(report), options.json);
}

async function handleTask(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd", "model", "mode", "resume", "sandbox", "prompt-file"],
    booleanOptions: ["background", "wait", "continue", "fresh", "read-only"]
  });

  if (options.background && options.wait) {
    throw new Error("Choose either --background or --wait.");
  }
  if (options.continue && options.fresh) {
    throw new Error("Choose either --continue or --fresh.");
  }
  if (options.resume && options.continue) {
    throw new Error("Choose either --resume <id> or --continue.");
  }

  const cwd = resolveCommandCwd(options);
  const workspace = resolveWorkspaceRoot(cwd);
  ensureCursorAvailable(cwd);

  const prompt = readPrompt(cwd, options, positionals);
  if (!prompt.trim() && !options.continue && !options.resume) {
    throw new Error("Provide a prompt, a prompt file, piped stdin, --continue, or --resume <id>.");
  }

  const opts = {
    prompt,
    workspace,
    force: !options["read-only"],
    continue: Boolean(options.continue),
    resume: options.resume ?? null,
    model: options.model ?? null,
    mode: options.mode ?? null,
    sandbox: options.sandbox ?? null
  };

  if (options.background) {
    const job = runBackground(opts, { summary: summarize(prompt || (options.continue ? "Continue latest Cursor thread" : "Resume Cursor thread")) });
    output(`Cursor task started in the background as ${job.id}. Check /cursor:sessions ${job.id} for progress.\n`);
    return;
  }

  const jobId = generateJobId("task");
  const sessionId = process.env[SESSION_ID_ENV] ?? null;
  const summary = summarize(prompt || (options.continue ? "Continue latest Cursor thread" : "Resume Cursor thread"));
  const startedAt = nowIso();
  const baseJob = {
    id: jobId,
    kind: "task",
    status: "running",
    foreground: true,
    prompt,
    model: opts.model,
    mode: opts.mode,
    force: opts.force,
    summary,
    startedAt,
    sessionId,
    workspaceRoot: workspace,
    logFile: resolveJobLogFile(workspace, jobId)
  };
  upsertJob(workspace, baseJob);
  writeJobFile(workspace, jobId, baseJob);

  let result;
  try {
    result = await runForeground(opts);
  } catch (error) {
    const failed = { ...baseJob, status: "failed", phase: "failed", completedAt: nowIso(), errorMessage: error?.message ?? String(error) };
    upsertJob(workspace, failed);
    writeJobFile(workspace, jobId, failed);
    throw error;
  }

  const finalJob = {
    ...baseJob,
    status: result.status,
    phase: result.status === "completed" ? "done" : "failed",
    threadId: result.threadId,
    durationMs: result.durationMs,
    exitCode: result.exitCode,
    completedAt: nowIso(),
    result: result.result
  };
  upsertJob(workspace, finalJob);
  writeJobFile(workspace, jobId, finalJob);

  output(renderTaskResult(result.result));
  process.exitCode = result.exitCode;
}

function handleStatus(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["all", "json"]
  });
  const cwd = resolveCommandCwd(options);
  const [reference] = positionals;
  if (reference) {
    const snapshot = buildSingleJobSnapshot(cwd, reference);
    output(options.json ? snapshot : renderJobStatusReport(snapshot.job), options.json);
    return;
  }
  const report = buildStatusSnapshot(cwd, { all: Boolean(options.all), env: process.env });
  output(options.json ? report : renderStatusReport(report), options.json);
}

function handleResult(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });
  const cwd = resolveCommandCwd(options);
  const [reference] = positionals;
  const { workspaceRoot, job } = resolveResultJob(cwd, reference);
  const storedJob = readStoredJob(workspaceRoot, job.id);
  const payload = { workspaceRoot, job, storedJob };
  output(options.json ? payload : renderStoredJobResult(job, storedJob), options.json);
}

function handleCancel(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });
  const cwd = resolveCommandCwd(options);
  const [reference] = positionals;
  const { workspaceRoot, job } = resolveCancelableJob(cwd, reference, { env: process.env });
  if (job.pid) {
    terminateProcessTree(job.pid, { cwd: workspaceRoot });
  }
  const completedAt = nowIso();
  const cancelled = {
    ...job,
    status: "cancelled",
    phase: "cancelled",
    completedAt,
    exitCode: null
  };
  upsertJob(workspaceRoot, cancelled);
  writeJobFile(workspaceRoot, job.id, cancelled);
  output(options.json ? cancelled : renderCancelReport(cancelled), options.json);
}

function handleResumeCandidate(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });
  const cwd = resolveCommandCwd(options);
  const candidate = getResumeCandidate(cwd, { env: process.env });
  output(options.json ? candidate : `${JSON.stringify(candidate)}\n`, options.json);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "setup":
      await handleSetup(rest);
      break;
    case "task":
      await handleTask(rest);
      break;
    case "status":
      handleStatus(rest);
      break;
    case "result":
      handleResult(rest);
      break;
    case "cancel":
      handleCancel(rest);
      break;
    case "task-resume-candidate":
      handleResumeCandidate(rest);
      break;
    default:
      printUsage();
      process.exitCode = command ? 1 : 0;
  }
}

main().catch((error) => {
  console.error(error?.message ?? String(error));
  process.exitCode = 1;
});
