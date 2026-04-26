import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { listJobs, upsertJob } from "../plugins/cursor/scripts/lib/state.mjs";

test("upsertJob persists and listJobs returns the job", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-state-test-"));
  const previousPluginData = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = tempRoot;

  try {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-workspace-test-"));
    upsertJob(workspace, {
      id: "task-test",
      kind: "task",
      status: "running",
      summary: "test job"
    });

    const jobs = listJobs(workspace);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].id, "task-test");
    assert.equal(jobs[0].summary, "test job");
  } finally {
    if (previousPluginData === undefined) {
      delete process.env.CLAUDE_PLUGIN_DATA;
    } else {
      process.env.CLAUDE_PLUGIN_DATA = previousPluginData;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
