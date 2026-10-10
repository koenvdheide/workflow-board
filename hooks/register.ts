import { read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { EMPTY_RUN, NOTE, POST_DESCRIPTION, POST_SCHEMA, READ_DESCRIPTION, READ_SCHEMA, mainRead, parsePost, parseRead, post, readFor } from './board'
import type { Reply } from './board'
import type { Run } from '../types'

// Everything that calls the engine lives in this file: the mod loader follows `$` only into
// functions declared here; a `$` call in an imported helper is invisible to it. board.ts holds the pure parts.

const POST = 'mcp__findings-board__post'
const READ = 'mcp__findings-board__read'
const NOT_IN_RUN = 'board: not in a workflow run'
const BIND = { plugin: 'findings-board', key: 'bind' } as const
const RUN = { plugin: 'findings-board', key: 'run' } as const

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

// Thrown from an update() callback so a refused transition writes nothing: update() writes
// whatever its callback returns, and an absent run would otherwise be stored empty.
class Refused {
  constructor(readonly deny: string) {}
}

const refusal = (err: unknown): Reply => ({ deny: err instanceof Refused ? err.deny : `board: store refused: ${message(err)}` })

// Serving a tool without next() skips the permission path, so an explicit deny is checked
// here; ask is served because MCP tools default to ask (spec §7).
async function denied($: EngineInterface, tool: string, input: unknown): Promise<string | undefined> {
  const { decision, reason } = await $.tool.check({ tool, input })
  return decision === 'deny' ? `board: denied${reason ? `: ${reason}` : ''}` : undefined
}

async function boundRun($: EngineInterface, agentId: string | undefined): Promise<string | undefined> {
  return agentId ? read($, { ...BIND, id: agentId }) : undefined
}

// Runs one board transition in update() and replies with the delivery of the attempt that landed.
async function serve($: EngineInterface, runId: string, step: (run: Run) => { run: Run; reply: Reply }): Promise<Reply> {
  let text = ''
  await update($, { ...RUN, id: runId }, run => {
    const out = step(run ?? EMPTY_RUN)
    if ('deny' in out.reply) throw new Refused(out.reply.deny)
    text = out.reply.result
    return out.run
  })
  return { result: text }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.tool.register({ name: 'post', description: POST_DESCRIPTION, inputSchema: POST_SCHEMA })
    await $.tool.register({ name: 'read', description: READ_DESCRIPTION, inputSchema: READ_SCHEMA })
    // A mid-session install or reload finds the Workflow description already rendered and cached.
    $.ui.invalidate('tool.describe')
    return started
  })

  on('tool.describe', { tool: 'Workflow' }, async ($, e, next) => {
    const described = await next(e)
    return { ...described, description: described.description + NOTE }
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    const runId = e.workflow?.runId
    const agentId = spawned.agentId
    if (runId && agentId) await update($, { ...BIND, id: agentId }, () => runId)
    return spawned
  })

  on('tool.call', { tool: POST }, async ($, e) => {
    const { tool: _tool, tool_use_id: _toolUseId, agentId, ...args } = e
    const refused = await denied($, POST, args)
    if (refused) return { deny: refused }
    try {
      const runId = await boundRun($, agentId)
      if (!agentId || !runId) return { deny: NOT_IN_RUN }
      const input = parsePost(args)
      if ('deny' in input) return input
      return await serve($, runId, run => post(run, agentId, input))
    } catch (err) {
      return refusal(err)
    }
  })

  on('tool.call', { tool: READ }, async ($, e) => {
    const { tool: _tool, tool_use_id: _toolUseId, agentId, ...args } = e
    const refused = await denied($, READ, args)
    if (refused) return { deny: refused }
    try {
      if (!agentId) {
        const named = args.run
        if (named === undefined || named === null) return { deny: 'board: run needed' }
        if (typeof named !== 'string') return { deny: 'board: run? str' }
        const q = parseRead(args)
        if ('deny' in q) return q
        const run = await read($, { ...RUN, id: named })
        if (!run) return { deny: `board: run ${named} unknown` }
        return mainRead(run, named, q)
      }
      const runId = await boundRun($, agentId)
      if (!runId) return { deny: NOT_IN_RUN }
      const q = parseRead(args)
      if ('deny' in q) return q
      return await serve($, runId, run => readFor(run, agentId, q))
    } catch (err) {
      return refusal(err)
    }
  })
}
