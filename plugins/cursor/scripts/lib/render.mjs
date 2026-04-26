function escapeMarkdownCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

function isActive(job) {
  return job.status === "queued" || job.status === "running";
}

function formatFollowUp(job) {
  if (isActive(job)) {
    return `/cursor:stop ${job.id}`;
  }
  return `/cursor:done ${job.id}`;
}

function appendJobsTable(lines, jobs) {
  lines.push("| ID | Kind | Status | Phase | Elapsed | Summary | Follow-up |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const job of jobs) {
    lines.push(
      `| ${escapeMarkdownCell(job.id)} | ${escapeMarkdownCell(job.kindLabel ?? "cursor")} | ${escapeMarkdownCell(job.status)} | ${escapeMarkdownCell(job.phase ?? "")} | ${escapeMarkdownCell(job.elapsed ?? job.duration ?? "")} | ${escapeMarkdownCell(job.summary ?? "")} | \`${escapeMarkdownCell(formatFollowUp(job))}\` |`
    );
  }
}

function appendJobDetails(lines, job, options = {}) {
  lines.push(`- ${job.id} | ${job.kindLabel ?? "cursor"} | ${job.status}`);
  if (job.summary) {
    lines.push(`  Summary: ${job.summary}`);
  }
  if (job.phase) {
    lines.push(`  Phase: ${job.phase}`);
  }
  if (options.showElapsed && job.elapsed) {
    lines.push(`  Elapsed: ${job.elapsed}`);
  }
  if (options.showDuration && job.duration) {
    lines.push(`  Duration: ${job.duration}`);
  }
  if (job.threadId) {
    lines.push(`  Cursor thread ID: ${job.threadId}`);
    lines.push(`  Resume in Cursor: cursor-agent --resume ${job.threadId}`);
  }
  if (job.logFile && options.showLog) {
    lines.push(`  Log: ${job.logFile}`);
  }
  if (isActive(job) && options.showCancelHint) {
    lines.push(`  Stop: /cursor:stop ${job.id}`);
  }
  if (!isActive(job) && options.showResultHint) {
    lines.push(`  Result: /cursor:done ${job.id}`);
  }
  if (job.progressPreview?.length) {
    lines.push("  Progress:");
    for (const line of job.progressPreview) {
      lines.push(`    ${line}`);
    }
  }
}

export function renderStatusReport(report) {
  const jobs = [
    ...report.running,
    ...(report.latestFinished ? [report.latestFinished] : []),
    ...report.recent
  ];

  if (jobs.length === 0) {
    return "No Cursor jobs recorded yet.\n";
  }

  const lines = [];
  appendJobsTable(lines, jobs);
  return `${lines.join("\n")}\n`;
}

export function renderJobStatusReport(job) {
  const lines = ["# Cursor Job Status", ""];
  appendJobDetails(lines, job, {
    showElapsed: isActive(job),
    showDuration: !isActive(job),
    showLog: true,
    showCancelHint: true,
    showResultHint: true
  });
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderTaskResult(result) {
  const rawOutput = typeof result?.rawOutput === "string" ? result.rawOutput : "";
  if (rawOutput) {
    return rawOutput.endsWith("\n") ? rawOutput : `${rawOutput}\n`;
  }
  const fallback = String(result?.failureMessage ?? "").trim() || "Cursor did not return a final message.";
  return `${fallback}\n`;
}

export function renderStoredJobResult(job, storedJob) {
  const threadId = storedJob?.threadId ?? job.threadId ?? null;
  const rawOutput =
    (typeof storedJob?.result?.rawOutput === "string" && storedJob.result.rawOutput) ||
    (typeof storedJob?.rawOutput === "string" && storedJob.rawOutput) ||
    "";

  const lines = [];
  if (rawOutput) {
    lines.push(rawOutput.trimEnd(), "");
  } else if (storedJob?.rendered) {
    lines.push(String(storedJob.rendered).trimEnd(), "");
  }

  lines.push(`Job: ${job.id}`);
  lines.push(`Status: ${job.status}`);
  if (threadId) {
    lines.push(`Cursor thread ID: ${threadId}`);
    lines.push(`Resume in Cursor: cursor-agent --resume ${threadId}`);
  }
  if (!rawOutput && !storedJob?.rendered && (job.errorMessage || storedJob?.errorMessage)) {
    lines.push("", job.errorMessage ?? storedJob.errorMessage);
  }
  if (!rawOutput && !storedJob?.rendered && !job.errorMessage && !storedJob?.errorMessage) {
    lines.push("", "No captured result payload was stored for this job.");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderCancelReport(job) {
  const lines = ["# Cursor Stop", "", `Cancelled ${job.id}.`, ""];
  if (job.summary) {
    lines.push(`- Summary: ${job.summary}`);
  }
  lines.push("- Check `/cursor:sessions` for the updated queue.");
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderSetupReport(report) {
  const lines = [
    "# Cursor Setup",
    "",
    `Status: ${report.ready ? "ready" : "needs attention"}`,
    "",
    "Checks:",
    `- node: ${report.node.detail}`,
    `- cursor-agent: ${report.cursor.detail}`,
    `- auth: ${report.auth.detail}`,
    ""
  ];

  if (report.actionsTaken?.length) {
    lines.push("Actions taken:");
    for (const action of report.actionsTaken) {
      lines.push(`- ${action}`);
    }
    lines.push("");
  }

  if (report.nextSteps?.length) {
    lines.push("Next steps:");
    for (const step of report.nextSteps) {
      lines.push(`- ${step}`);
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
