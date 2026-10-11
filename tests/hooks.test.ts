import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { NOTE } from '../hooks/board'
import { denied } from '../hooks/register'

const POST = 'mcp__workflow-board__post'
const READ = 'mcp__workflow-board__read'
const NOT_IN_RUN = 'board: not in a workflow run'

type World = { decisions: Record<string, 'allow' | 'ask' | 'deny' | 'reject'>; registered: string[]; invalidated: string[]; failGet: boolean; failSet: boolean; race: unknown }

// Hooks beneath the plugin stand in for engine parts the test engine lacks (tool.check,
// ui.invalidate), answer spawns and the board's registrations, and can refuse state calls.
// Setting `race` makes the next write of a run lose a compare-and-set to a competing write of that value.
// A 'reject' decision passes the check on to the test engine, which rejects it the way the engine
// rejects a check on a tool a deny rule removed from the session.
// They must be registered before the test's first $ call.
async function boot($: any, on: On): Promise<World> {
  const w: World = { decisions: {}, registered: [], invalidated: [], failGet: false, failSet: false, race: undefined }
  on('tool.register', ($: any, e: any) => {
    w.registered.push(e.name)
    return { value: { tool: `mcp__workflow-board__${e.name}` } }
  })
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('ui.invalidate', ($: any, e: any) => {
    w.invalidated.push(e.event)
    return { value: undefined }
  })
  on('tool.check', ($: any, e: any, next: any) => (w.decisions[e.tool] === 'reject' ? next(e) : { decision: w.decisions[e.tool] ?? 'allow', reason: 'rule' }))
  on('state.get', ($: any, e: any, next: any) => (w.failGet ? { deny: 'EACCES: unreadable' } : next(e)))
  on('state.set', async ($: any, e: any, next: any) => {
    if (w.failSet) return { deny: 'EACCES: read-only' }
    if (w.race === undefined || e.key !== 'run') return next(e)
    const { ifVersion: _beaten, ...unconditional } = e
    const rival = w.race
    w.race = undefined
    const { value: landed } = await next({ ...unconditional, value: rival })
    return { value: { isSet: false, version: landed.version } }
  })
  on('tool.describe', () => ({ description: 'BENEATH' }))
  // The spawned agent's id is its prompt, so a test names its agents.
  on('agent.spawn', ($: any, e: any) => (e.prompt.startsWith('deny') ? { deny: 'no' } : { model: 'm', agentId: e.prompt }))
  on('tool.call', { tool: 'mcp__other__op' }, () => ({ result: 'ran' }))
  on('tool.call', { tool: 'mcp__other__ctx' }, () => ({ result: 'ran', context: ['x'] }))
  on('tool.call', { tool: 'mcp__other__denied' }, () => ({ deny: 'no' }))
  await $.session.start({ cwd: 'C:/repo', surface: null, isInteractive: true })
  return w
}

let n = 0
const spawn = ($: any, agentId: string, runId?: string) =>
  $.agent.spawn({
    tool_use_id: `sp${(n += 1)}`, prompt: agentId, description: 'd', subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' }, parentModel: 'm', background: true, fork: false,
    ...(runId ? { workflow: { runId, agentIndex: n } } : {}),
  })
const call = ($: any, tool: string, agentId: string | undefined, args: Record<string, unknown> = {}) =>
  $.tool.call({ tool, tool_use_id: `tu${(n += 1)}`, ...(agentId ? { agentId } : {}), ...args })

describe('registration', () => {
  test('session.start registers post and read and invalidates cached tool descriptions', async ($, on) => {
    const w = await boot($, on)
    expect(w.registered).toEqual(['post', 'read'])
    expect(w.invalidated).toEqual(['tool.describe'])
  })

  test('the Workflow description gets the note; other tools keep theirs', async ($, on) => {
    await boot($, on)
    const provider = { plugin: 'engine', tier: 'core' }
    expect((await $.tool.describe({ tool: 'Workflow', description: 'ORIG', provider })).description).toBe(`BENEATH${NOTE}`)
    expect((await $.tool.describe({ tool: 'Bash', description: 'ORIG', provider })).description).toBe('BENEATH')
  })
})

describe('binding and authorization', () => {
  test('a workflow spawn binds its agent and its post lands', async ($, on) => {
    await boot($, on)
    expect(await spawn($, 'ag1', 'wf_bind')).toEqual({ model: 'm', agentId: 'ag1' })
    expect((await call($, POST, 'ag1', { kind: 'find', head: 'h' })).result).toBe('#1 ok')
    expect((await call($, READ, 'ag1', { id: 1 })).result).toBe('#1 a1 find · open\nh')
  })

  test('a spawn denied beneath binds nothing', async ($, on) => {
    await boot($, on)
    expect((await spawn($, 'deny-ag', 'wf_denied')).deny).toBe('no')
    expect((await call($, POST, 'deny-ag', { kind: 'find', head: 'h' })).deny).toBe(NOT_IN_RUN)
  })

  test('a deny refuses before the binding check', async ($, on) => {
    const w = await boot($, on)
    w.decisions = { [POST]: 'deny', [READ]: 'deny' }
    expect((await call($, POST, 'ghost', { kind: 'find', head: 'h' })).deny).toBe('board: denied: rule')
    expect((await call($, READ, undefined)).deny).toBe('board: denied: rule')
  })

  test('a spawn without workflow binds nothing', async ($, on) => {
    await boot($, on)
    await spawn($, 'ag9')
    expect((await call($, POST, 'ag9', { kind: 'find', head: 'h' })).deny).toBe(NOT_IN_RUN)
    expect((await call($, READ, 'ag9')).deny).toBe(NOT_IN_RUN)
    expect((await call($, READ, 'ghost')).deny).toBe(NOT_IN_RUN)
  })

  test('bad input is refused with the board text', async ($, on) => {
    await boot($, on)
    await spawn($, 'ag1', 'wf_input')
    expect((await call($, POST, 'ag1', { kind: 'note', head: 'h' })).deny).toBe('board: kind? find|decide|ask|challenge|confirm|claim')
    expect((await call($, READ, 'ag1', { since: -1 })).deny).toBe('board: since? int')
  })

  test('runs are isolated, and an agent cannot read another run', async ($, on) => {
    await boot($, on)
    await spawn($, 'ag1', 'wf_a')
    await spawn($, 'ag2', 'wf_b')
    await call($, POST, 'ag1', { kind: 'find', head: 'secret' })
    expect((await call($, READ, 'ag2')).result).toBe('no unread')
    expect((await call($, READ, 'ag2', { run: 'wf_a' })).result).toBe('no unread')
    expect((await call($, READ, 'ag2', { kind: 'find' })).result).toBe('no match')
  })

  test('the main loop reads a named run and cannot post', async ($, on) => {
    await boot($, on)
    await spawn($, 'ag1', 'wf_main')
    await call($, POST, 'ag1', { kind: 'find', head: 'h' })
    expect((await call($, READ, undefined)).deny).toBe('board: run needed')
    expect((await call($, READ, undefined, { run: 5 })).deny).toBe('board: run? str')
    expect((await call($, READ, undefined, { run: 'wf_x' })).deny).toBe('board: run wf_x unknown')
    expect((await call($, READ, undefined, { run: 'wf_main' })).result).toBe('#1 a1 find h')
    expect((await call($, POST, undefined, { kind: 'find', head: 'h' })).deny).toBe(NOT_IN_RUN)
  })

  test('a refused first call writes no run state', async ($, on) => {
    await boot($, on)
    await spawn($, 'ag1', 'wf_refused')
    expect((await call($, POST, 'ag1', { kind: 'challenge', head: 'x', re: 5 })).deny).toBe('board: #5 unknown')
    expect((await call($, READ, 'ag1', { id: 9 })).deny).toBe('board: #9 unknown')
    expect((await call($, READ, undefined, { run: 'wf_refused' })).deny).toBe('board: run wf_refused unknown')
  })

  test('a deny on one board tool refuses that tool only; ask is served', async ($, on) => {
    const w = await boot($, on)
    await spawn($, 'ag1', 'wf_perm')
    w.decisions[POST] = 'deny'
    expect((await call($, POST, 'ag1', { kind: 'find', head: 'h' })).deny).toBe('board: denied: rule')
    expect((await call($, READ, 'ag1')).result).toBe('no unread')
    w.decisions = { [READ]: 'deny' }
    expect((await call($, READ, 'ag1')).deny).toBe('board: denied: rule')
    expect((await call($, POST, 'ag1', { kind: 'find', head: 'h' })).result).toBe('#1 ok')
    w.decisions = { [POST]: 'ask', [READ]: 'ask' }
    expect((await call($, POST, 'ag1', { kind: 'find', head: 'h' })).result).toBe('#2 ok')
    expect((await call($, READ, 'ag1')).result).toBe('no unread')
  })

  test('a refused state read or write comes back as store refused', async ($, on) => {
    const w = await boot($, on)
    await spawn($, 'ag1', 'wf_store')
    expect((await call($, POST, 'ag1', { kind: 'find', head: 'h' })).result).toBe('#1 ok')
    w.failSet = true
    const write = await call($, POST, 'ag1', { kind: 'find', head: 'h' })
    expect(write.deny).toStartWith('board: store refused: ')
    expect(write.deny).toContain('EACCES: read-only')
    const readWrite = await call($, READ, 'ag1')
    expect(readWrite.deny).toStartWith('board: store refused: ')
    expect(readWrite.deny).toContain('EACCES: read-only')
    w.failSet = false
    w.failGet = true
    for (const r of [await call($, POST, 'ag1', { kind: 'find', head: 'h' }), await call($, READ, 'ag1'), await call($, READ, undefined, { run: 'wf_store' })]) {
      expect(r.deny).toStartWith('board: store refused: ')
      expect(r.deny).toContain('EACCES: unreadable')
    }
  })

  test('a post retried after a competing write replies with the id that landed', async ($, on) => {
    const w = await boot($, on)
    await spawn($, 'ag1', 'wf_race1')
    w.race = { entries: [{ by: 'a1', kind: 'find', head: 'rival' }], agents: { rival: { h: 'a1', cur: 0 } } }
    expect((await call($, POST, 'ag1', { kind: 'find', head: 'h' })).result).toBe('#2 ok')
    expect((await call($, READ, undefined, { run: 'wf_race1' })).result).toBe('#1 a1 find rival\n#2 a2 find h')
  })
})

const OTHER = 'mcp__other__op'
const DENIED = 'mcp__other__denied'
const pushed = (...lines: string[]) => [['board (sibling data, verify before use):', ...lines].join('\n')]
const contextOf = (r: any) => r.context ?? []

// ag2 subscribes first (handle a1); ag1 then posts entry #1 (handle a2).
async function twoAgents($: any, on: On, runId: string): Promise<World> {
  const w = await boot($, on)
  await spawn($, 'ag1', runId)
  await spawn($, 'ag2', runId)
  expect((await call($, READ, 'ag2')).result).toBe('no unread')
  expect((await call($, POST, 'ag1', { kind: 'find', head: 'h1' })).result).toBe('#1 ok')
  return w
}

describe('push', () => {
  test('a sibling entry arrives once on the next non-board tool result', async ($, on) => {
    await twoAgents($, on, 'wf_p1')
    const r = await call($, OTHER, 'ag2')
    expect(r.result).toBe('ran')
    expect(contextOf(r)).toEqual(pushed('#1 a2 find h1'))
    expect(contextOf(await call($, OTHER, 'ag2'))).toEqual([])
  })

  test('the poster gets no push of its own entry', async ($, on) => {
    await twoAgents($, on, 'wf_p2')
    expect(contextOf(await call($, OTHER, 'ag1'))).toEqual([])
  })

  test('a denied result carries no push and the entry waits for the next one', async ($, on) => {
    await twoAgents($, on, 'wf_p3')
    const d = await call($, DENIED, 'ag2')
    expect(d.deny).toBe('no')
    expect(contextOf(d)).toEqual([])
    expect(contextOf(await call($, OTHER, 'ag2'))).toEqual(pushed('#1 a2 find h1'))
  })

  test('an agent that never used the board and the main loop get nothing', async ($, on) => {
    await twoAgents($, on, 'wf_p4')
    await spawn($, 'ag3', 'wf_p4')
    expect(contextOf(await call($, OTHER, 'ag3'))).toEqual([])
    expect(contextOf(await call($, OTHER, undefined))).toEqual([])
  })

  test('a read deny suppresses the push and keeps the position; a post deny does not', async ($, on) => {
    const w = await twoAgents($, on, 'wf_p5')
    w.decisions = { [READ]: 'deny' }
    expect(contextOf(await call($, OTHER, 'ag2'))).toEqual([])
    expect((await call($, POST, 'ag1', { kind: 'find', head: 'h2' })).result).toBe('#2 ok')
    w.decisions = { [POST]: 'deny' }
    expect(contextOf(await call($, OTHER, 'ag2'))).toEqual(pushed('#1 a2 find h1', '#2 a2 find h2'))
  })

  test('board tool results carry no push', async ($, on) => {
    await twoAgents($, on, 'wf_p6')
    const r = await call($, POST, 'ag2', { kind: 'find', head: 'mine' })
    expect(r.result).toBe('#2 ok')
    expect(contextOf(r)).toEqual([])
    expect(contextOf(await call($, OTHER, 'ag2'))).toEqual(pushed('#1 a2 find h1'))
  })

  test('the push block follows context already on the result', async ($, on) => {
    await twoAgents($, on, 'wf_p7')
    expect(contextOf(await call($, 'mcp__other__ctx', 'ag2'))).toEqual(['x', ...pushed('#1 a2 find h1')])
  })

  test('a failed push step keeps the tool result and the entry waits', async ($, on) => {
    const w = await twoAgents($, on, 'wf_p8')
    w.failSet = true
    const r = await call($, OTHER, 'ag2')
    expect(r.result).toBe('ran')
    expect(contextOf(r)).toEqual([])
    w.failSet = false
    expect(contextOf(await call($, OTHER, 'ag2'))).toEqual(pushed('#1 a2 find h1'))
  })

  test('a read check that rejects suppresses the push; the entry arrives once it answers', async ($, on) => {
    const w = await twoAgents($, on, 'wf_p10')
    w.decisions = { [READ]: 'reject' }
    const r = await call($, OTHER, 'ag2')
    expect(r.result).toBe('ran')
    expect(contextOf(r)).toEqual([])
    w.decisions = {}
    expect(contextOf(await call($, OTHER, 'ag2'))).toEqual(pushed('#1 a2 find h1'))
  })

  test('the permission helper resolves a rejected check as a deny', async ($, on) => {
    const w = await boot($, on)
    w.decisions = { [READ]: 'reject' }
    expect(await denied($, READ, {})).toStartWith('board: denied: ')
    w.decisions = {}
    expect(await denied($, READ, {})).toBeUndefined()
  })

  test('a push retried after a competing write delivers what landed', async ($, on) => {
    const w = await twoAgents($, on, 'wf_p9')
    w.race = {
      entries: [{ by: 'a2', kind: 'find', head: 'h1' }, { by: 'a2', kind: 'find', head: 'h2' }],
      agents: { ag2: { h: 'a1', cur: 0 }, ag1: { h: 'a2', cur: 0 } },
    }
    expect(contextOf(await call($, OTHER, 'ag2'))).toEqual(pushed('#1 a2 find h1', '#2 a2 find h2'))
  })
})

describe('refused calls', () => {
  test('a refused board call does not subscribe', async ($, on) => {
    await twoAgents($, on, 'wf_sub')
    await spawn($, 'ag3', 'wf_sub')
    expect((await call($, POST, 'ag3', { kind: 'note', head: 'h' })).deny).toBe('board: kind? find|decide|ask|challenge|confirm|claim')
    expect((await call($, READ, 'ag3', { id: 9 })).deny).toBe('board: #9 unknown')
    expect(contextOf(await call($, OTHER, 'ag3'))).toEqual([])
  })

  test('input the engine could not parse is refused right after the permission check', async ($, on) => {
    const w = await twoAgents($, on, 'wf_raw')
    await spawn($, 'ag3', 'wf_raw')
    const text = '{"since": 0, "tag": "auth"'
    const raw = { __unparsedToolInput: { raw: text, len: text.length } }
    for (const agentId of ['ag3', 'ag2', undefined]) {
      expect((await call($, POST, agentId, raw)).deny).toBe('board: input? json')
      expect((await call($, READ, agentId, raw)).deny).toBe('board: input? json')
    }
    w.decisions = { [READ]: 'deny' }
    expect((await call($, READ, 'ag2', raw)).deny).toBe('board: denied: rule')
    w.decisions = {}
    expect(contextOf(await call($, OTHER, 'ag2'))).toEqual(pushed('#1 a2 find h1'))
    await spawn($, 'ag4', 'wf_raw')
    expect((await call($, POST, 'ag4', { kind: 'find', head: 'h2' })).result).toBe('#2 ok')
    expect((await call($, READ, undefined, { run: 'wf_raw', id: 2 })).result).toStartWith('#2 a3 find')
  })
})
