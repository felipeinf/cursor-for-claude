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
- When `/cursor:agent` was invoked with `--context`, the natural-language prompt already includes a fixed five-line session block (Goal, Recent decisions, Files touched, Current state, Open question). Facts only; no transcripts, secrets, or code. If nothing concrete exists to summarize, that block is omitted by the slash command—do not invent one in the subagent.