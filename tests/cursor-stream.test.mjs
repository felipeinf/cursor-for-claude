import assert from "node:assert/strict";
import test from "node:test";

import { createCursorStreamParser, parseStreamLine } from "../plugins/cursor/scripts/lib/cursor.mjs";

test("cursor stream parser captures thread, progress, tool calls, and final result", () => {
  const parser = createCursorStreamParser();
  const lines = [
    JSON.stringify({ type: "system", subtype: "init", thread_id: "thread-123" }),
    JSON.stringify({ type: "assistant", text: "Looking at the parser." }),
    JSON.stringify({ type: "tool_call", name: "edit_file" }),
    JSON.stringify({ type: "result", subtype: "completed", result: "Fixed parser tests.", duration_ms: 42 })
  ];

  for (const line of lines) {
    parseStreamLine(line, parser);
  }

  assert.equal(parser.state.threadId, "thread-123");
  assert.deepEqual(parser.state.progressPreview, [
    "Thread ready: thread-123",
    "Looking at the parser.",
    "Running tool: edit_file"
  ]);
  assert.equal(parser.state.finalText, "Fixed parser tests.");
  assert.equal(parser.state.durationMs, 42);
  assert.equal(parser.state.status, "completed");
});
