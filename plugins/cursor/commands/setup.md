---
description: Check whether the Cursor CLI is installed and authenticated; optionally install it
allowed-tools: Bash(node:*), Bash(curl:*), AskUserQuestion
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/cursor-companion.mjs" setup --json
```

If `cursor-agent` is missing:
- Use `AskUserQuestion` exactly once to ask whether Claude should install Cursor CLI now.
- Put the install option first and suffix it with `(Recommended)`.
- Use these two options:
  - `Install Cursor CLI (Recommended)`
  - `Skip for now`
- If the user chooses install, run:

```bash
curl https://cursor.com/install -fsS | bash
```

- Then rerun:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/cursor-companion.mjs" setup --json
```

If Cursor is installed but not authenticated, surface the guidance to set `CURSOR_API_KEY` in the environment or run `!cursor-agent` interactively to log in. Do not auto-execute login.
