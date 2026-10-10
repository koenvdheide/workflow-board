# Changelog

All notable changes to findings-board will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-10

### Added

- A findings board per Workflow run, with `post` and `read` tools for the run's agents and `read {run}` for the main conversation.
- Pushes of new sibling entries, at most 5 lines, on the tool results of agents that have used the board.
- A note on the Workflow tool description telling Claude how to opt agents in.
- Permission deny rules on the board tools are honoured, pushes included.
