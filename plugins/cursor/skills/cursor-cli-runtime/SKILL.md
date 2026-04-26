---
name: cursor-cli-runtime
description: Internal helper contract for calling the cursor-companion runtime from Claude Code
user-invocable: false
---

# Cursor Runtime

Use this skill only inside the `cursor:cursor-agent` subagent.

Primary helper:
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/cursor-companion.mjs" task "<raw arguments>"`

Rules:
- Invoke the companion with one `Bash` call and return stdout unchanged.
- Never read files, inspect repository state, grep, monitor, poll, fetch results, or cancel jobs.
- Do not call `setup`, `status`, `result`, or `cancel`.
- Map `--continue` to `task --continue`.
- Map `--resume <id>` to `task --resume <id>`.
- Map `--fresh` to a fresh `task` call without resume flags.
- Pass `--read-only` only when the user requested read-only behavior.
- Preserve the user's task text apart from routing flags.
