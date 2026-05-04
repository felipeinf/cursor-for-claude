---
description: Delegate a task to Cursor via the cursor-agent subagent (background by default)
argument-hint: "[--context] [--wait|--background] [--continue|--fresh] [--model <name>] [--mode plan|ask] [--read-only] <task>"
allowed-tools: Bash(node:*), AskUserQuestion, Agent
---

Invoke the `cursor:cursor-agent` subagent via the `Agent` tool (`subagent_type: "cursor:cursor-agent"`), forwarding the natural-language prompt as described below (raw task text with routing flags stripped, or the combined context-plus-task string when `--context` was used).
The final user-visible response must be Cursor's output verbatim.

Raw user request:
$ARGUMENTS

Context flag:

- If the request includes `--context`, handle it only in this command. Do not forward `--context` to the subagent or to `task`.
- Before anything else below, if `--context` was present: build a short (~5 lines, one per field) context block from this Claude session’s recent conversation and prepend it to the user’s task text. Use that combined string as the natural-language prompt passed to the subagent. Remove `--context` from both routing flags and task text.
- Fixed template:

```text
## Context (from Claude session)
- Goal: <one line>
- Recent decisions: <one line>
- Files touched: <comma-separated paths, or "n/a">
- Current state: <one line>
- Open question / blocker: <one line, or "none">

## Task
<original user task text>
```

- Block rules: facts already stated in the conversation only; no invention. No literal transcript, no code snippets, no secrets, keys, or tokens. If a field does not apply, use `n/a` or `none`. If nothing concrete exists to summarize (e.g. first message in session), omit the context block and tell the user briefly before continuing.
- If the user combines `--context` with `--continue` or `--resume`, still prepend the block as above.
- `--context` is exclusive to this slash command and is never a `cursor-agent` or companion flag.

Execution mode:

- If the request includes `--wait`, run the `cursor:cursor-agent` subagent in the foreground.
- Otherwise (no flag or explicit `--background`), run the `cursor:cursor-agent` subagent in the background. Background is the default.
- `--background` and `--wait` are execution flags for Claude Code. Do not forward them to `task`, and do not treat them as part of the natural-language task text.
- `--model`, `--mode`, and `--read-only` are runtime flags. Preserve them for the forwarded `task` call, but do not treat them as part of the natural-language task text.
- `--context` is handled only here (see Context flag); never forward it to `task`.
- If the request includes `--continue`, `--resume <id>`, or `--fresh`, do not ask whether to continue. The user already chose.
- Otherwise, before starting Cursor, check for a resumable thread from this Claude session by running:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/cursor-companion.mjs" task-resume-candidate --json
```

- If that helper reports `available: true`, use `AskUserQuestion` exactly once to ask whether to continue the current Cursor thread or start a new one.
- The two choices must be:
  - `Continue current Cursor thread`
  - `Start a new Cursor thread`
- If the user is clearly giving a follow-up instruction such as "continue", "keep going", "resume", "apply the top fix", or "dig deeper", put `Continue current Cursor thread (Recommended)` first.
- Otherwise put `Start a new Cursor thread (Recommended)` first.
- If the user chooses continue, add `--continue` before routing to the subagent.
- If the user chooses a new thread, add `--fresh` before routing to the subagent.
- If the helper reports `available: false`, do not ask. Route normally.

Operating rules:

- The subagent is a thin forwarder only. It should use one `Bash` call to invoke `node "${CLAUDE_PLUGIN_ROOT}/scripts/cursor-companion.mjs" task ...` and return that command's stdout as-is.
- Return the Cursor companion stdout verbatim to the user.
- Do not paraphrase, summarize, rewrite, or add commentary before or after Cursor’s stdout (except building the optional session context block when `--context` was requested).
- Default to write-capable runs. `--read-only` suppresses `--force`.
- If the helper reports that Cursor is missing or unauthenticated, stop and tell the user to run `/cursor:setup`.
- If the user did not supply a request, ask what Cursor should investigate or fix.

