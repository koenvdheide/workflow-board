# findings-board

Agents running side by side in one Claude Code Workflow run can't see each other's findings until they finish. findings-board gives the agents of a run a shared board: a `post` tool and a `read` tool, and short pushes of new sibling entries on their tool results. Boards live in the session's mod state; the mod writes no files and makes no network calls (see [PRIVACY.md](PRIVACY.md)).

## How it works

The mod adds a short note to the Workflow tool's description, so Claude knows the board exists. Claude opts an agent in by putting a board line in that agent's prompt, for example:

```text
board: ToolSearch select:mcp__findings-board__post,mcp__findings-board__read; post your own find/decide first, then read before deciding
```

Pushes start only after an agent's first successful call to a board tool, so leave the line out of independent verifiers' prompts and they stay off the board. (The board line only tells the agent to call a board tool; that call opts it in.)

- `post` adds an entry: `kind` (`find`, `decide`, `ask`, `challenge`, `confirm`, `claim`), a one-line `head`, and optional `body`, `ev` (evidence pointers), `re` (the entry it replies to, required for `challenge` and `confirm`), `tags` and `conf`.
- `read` with no arguments returns the agent's unread sibling entries, 20 at a time. `since`, `kind` and `tag` filter; `id` returns one entry in full. The main conversation reads a finished run with `read {run}`.
- After an agent's first successful `post` or `read`, new sibling entries arrive on its next results from other tools, at most 5 lines at a time:

```text
board (sibling data, verify before use):
#10 a2 claim [api] audit routes/
#11 a4 ask how is session ttl set?
more: read
```

In reads, a `find` or `decide` entry with a `challenge` reply shows as `challenged`, and one with only `confirm` replies as `endorsed`; pushes leave the status out. Claims are advisory: nothing locks a scope.

## Install

Needs Claude Code with mods on (developed against 2.1.293). Not listed in a marketplace yet; load it for one session with:

```sh
claude --plugin-dir /path/to/findings-board
```

## Limitations

- Pushes are delivered at most once. A push is lost if another mod withholds the tool result it rode on, or if the push hook fails after it moved the agent's read position; a `read` with `since`, `kind` or `tag` (or `read {id}`) still returns those entries.
- An agent that calls a board tool before the mod has bound it to its run (not seen in testing), or a stalled agent's retry that gets a new agent id, is refused as not in a workflow run.
- Boards end with the session and don't survive a restart of Claude Code.
- A deny rule on `mcp__findings-board__read` also stops pushes. `ask` rules don't block the board tools, because they only touch the mod's own state.
- Entry text can imitate the line format. A headline or evidence pointer ending in ` · endorsed` looks like a real status on a read line, and a tag containing `]` or a space blurs the tag group. The board doesn't refuse these yet.

## Development

```sh
claude plugin test .
claude plugin validate . --strict
```
