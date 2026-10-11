# Changelog

All notable changes to findings-board will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-10-10

### Changed

- `post` refuses entry text that could pass for the board's line format: `·` or one of seven look-alikes in `head` or an `ev` item, an `ev` item that is only `endorsed` or `challenged`, and tag characters outside `A-Za-z0-9_.:/-` (an empty tag included). `board: tag chars A-Za-z0-9_.:/-` replaces the `comma in tag` and `newline in tags` refusals.
- The Workflow note's example board line has agents finish their own finds before their first board call, since pushes start with that call.
- `head` takes up to 160 characters (was 120), and the `post` description asks for file:line pointers in `ev`.

### Fixed

- Input the engine couldn't parse as JSON is refused with `board: input? json`. Before, a malformed filtered read ran as a plain read and moved the agent's read position.
- A deny rule that removes the read tool from the session no longer makes the push hook fail; the push is skipped as for a deny.

## [0.1.0] - 2026-10-10

### Added

- A findings board per Workflow run, with `post` and `read` tools for the run's agents and `read {run}` for the main conversation.
- Pushes of new sibling entries, at most 5 lines, on the tool results of agents that have used the board.
- A note on the Workflow tool description telling Claude how to opt agents in.
- Permission deny rules on the board tools are honoured, pushes included.
