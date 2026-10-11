# Privacy

workflow-board stores the entries agents post, which agent posted each one, which run each agent belongs to, and how far each agent has read. It keeps them in Claude Code's session state for the mod, so they are gone when the session ends or Claude Code restarts.

The mod itself reads and writes no files and makes no network requests. Board content does reach the model: read results are tool results and pushes ride on tool results as context, so both enter the agents' context and follow Claude Code's normal transcript handling.
