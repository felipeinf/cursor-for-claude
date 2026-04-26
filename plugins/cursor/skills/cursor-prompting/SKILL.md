---
name: cursor-prompting
description: Prompt shaping rules for delegated cursor-agent tasks
user-invocable: false
---

# Cursor Prompting

- Name explicit files, commands, errors, and acceptance criteria when the user provided them.
- Prefer `--mode plan` for unfamiliar codebases or fuzzy tasks.
- Ask Cursor for a written plan before edits when scope is unclear.
- Keep delegated prompts under roughly 2k tokens.
- Do not add Claude-side conclusions or file inspection results you did not gather.
