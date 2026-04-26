---
description: Show active and recent Cursor jobs for this repository
argument-hint: '[job-id] [--all]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/cursor-companion.mjs" status "$ARGUMENTS"`

If the user did not pass a job ID, render the command output as a single Markdown table.
If the user did pass a job ID, present the full command output verbatim.
