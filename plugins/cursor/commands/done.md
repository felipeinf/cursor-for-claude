---
description: Show the stored final output for a finished Cursor job
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/cursor-companion.mjs" result "$ARGUMENTS"`

Present the full command output to the user. Preserve the Cursor thread ID so the user can run `cursor-agent --resume <id>`.
