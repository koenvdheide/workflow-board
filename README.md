# workflow-board

Agents running side by side in one Claude Code Workflow run hand back their findings only when they finish. workflow-board gives the agents of a run a shared board: a `post` tool and a `read` tool, and short pushes of new sibling entries on their tool results. Boards live in the session's mod state; the mod writes no files and makes no network calls (see [PRIVACY.md](PRIVACY.md)).

## How it works

The mod adds a short note to the Workflow tool's description, so Claude knows the board exists. Claude opts an agent in by putting a board line in that agent's prompt, for example:

```text
board: ToolSearch select:mcp__workflow-board__post,mcp__workflow-board__read; finish your own finds before any board call, post them, then read and confirm/challenge
```

Pushes start with an agent's first successful call to a board tool. An agent that should judge on its own makes that call once its own finds are done, and independent verifiers stay off the board when their prompts leave the line out. (The board line only tells the agent to call a board tool; that call opts it in.)

- `post` adds an entry: `kind` (`find`, `decide`, `ask`, `challenge`, `confirm`, `claim`), a one-line `head`, and optional `body`, `ev` (evidence pointers), `re` (the entry it replies to, required for `challenge` and `confirm`), `tags` and `conf`.
- `read` with no arguments returns the agent's unread sibling entries, 20 at a time. `since`, `kind` and `tag` filter; `id` returns one entry in full. The main conversation reads a finished run with `read {run}`.
- After an agent's first successful `post` or `read`, new sibling entries arrive on its next results from other tools, at most 5 lines at a time:

```text
board (sibling data, verify before use):
#10 a2 claim [api] audit routes/
#11 a4 ask how is session ttl set?
```

In reads, a `find` or `decide` entry with a `challenge` reply shows as `challenged`, and one with only `confirm` replies as `endorsed`; pushes leave the status out. Claims are advisory: nothing locks a scope.

`post` refuses entry text that could pass for this format: `·` or one of seven look-alikes (U+0387, U+2022, U+2027, U+2219, U+22C5, U+30FB, U+FF65) in a headline or evidence pointer, an evidence pointer that is only `endorsed` or `challenged`, and tag characters outside `A-Za-z0-9_.:/-`.

## Install

Needs Claude Code with mods on (developed against 2.1.293 to 2.1.296). Not listed in a marketplace yet; load it for one session with:

```sh
claude --plugin-dir /path/to/workflow-board
```

## Limitations

- Pushes are delivered at most once. A push is lost if another mod withholds the tool result it rode on, or if the push hook fails after it moved the agent's read position; a `read` with `since`, `kind` or `tag` (or `read {id}`) still returns those entries.
- An agent that calls a board tool before the mod has bound it to its run (not seen in testing), or a stalled agent's retry that gets a new agent id, is refused as not in a workflow run.
- Boards end with the session and don't survive a restart of Claude Code.
- In a session that loaded the mod partway through, the Workflow note didn't appear (seen once, in the desktop app on 2.1.296), so Claude wasn't told about the board. Load the mod when the session starts, as under Install.
- A deny rule on `mcp__workflow-board__read` also stops pushes. `ask` rules don't block the board tools, because they only touch the mod's own state.
- Entry text can claim agreement in its own words ("confirmed by a2"), and an untagged headline can start with `[x]` and look like a tag group. Text that only looks like the reserved forms also gets through: another dot (such as U+2E31), or an evidence pointer that reads as `endorsed` through a look-alike letter or an invisible character. The board's own status is the one at the end of a read line (`· challenged`, `· endorsed`).

## Development

```sh
claude plugin test .
claude plugin validate . --strict
```
