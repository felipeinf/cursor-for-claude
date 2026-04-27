# cursor-plugin-cc

A Claude Code plugin that delegates coding tasks to your local `cursor-agent` and tracks background jobs per repository.

## Requirements

- Claude Code (with plugin support)
- Node.js on `PATH`
- `cursor-agent` installed and authenticated (`CURSOR_API_KEY` or `cursor-agent` interactive login)

## Install

Add this folder as a local marketplace in Claude Code, enable the `cursor` plugin, then run:

```text
/cursor:setup
```

`/cursor:setup` checks the CLI and auth, and can install `cursor-agent` for you if missing.

## Commands


| Command                 |  What it does                                   |                                                                |
| ----------------------- | ----------------------------------------------- | -------------------------------------------------------------- |
| `/cursor:agent <task>`  | Delegate a task to Cursor (default: background, write-capable) |                                                 |
| `/cursor:sessions [id]` | List jobs for this repo, or show one            |                                                                |
| `/cursor:done [id]`     | Show the stored final output for a finished job |                                                                |
| `/cursor:stop [id]`     | Cancel an active background job                 |                                                                |
| `/cursor:setup`         | Check install + auth                            |                                                                |


## Examples

```text
/cursor:agent fix the failing parser tests
/cursor:agent --wait quick rename in this file
/cursor:agent --read-only investigate why checkout is slow
/cursor:agent --continue apply the next fix
/cursor:agent --mode plan map the auth refactor
```

Default flow (background):

```text
/cursor:agent <task>
/cursor:sessions
/cursor:done <job-id>
```

Use `--wait` when you want the result inline.

## How it works

The plugin spawns `cursor-agent -p "<prompt>" --output-format stream-json --workspace <repo>` and parses the JSON stream. Job state lives under `CLAUDE_PLUGIN_DATA` (or a temp `cursor-companion` directory as fallback).

## License

MIT.
