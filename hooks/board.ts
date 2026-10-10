import type { AgentRow, Conf, Entry, Kind, Run } from '../types'

export const KINDS: readonly Kind[] = ['find', 'decide', 'ask', 'challenge', 'confirm', 'claim']
export const CONFS: readonly Conf[] = ['lo', 'mid', 'hi']

// Newlines, tabs, C0/C1 controls and Unicode line separators: a single-line field must not
// forge extra lines.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/

// Every line terminator a reader may break at, so each body line gets the indent that keeps it
// from passing as an ev, replies or entry line.
const BODY_LINES = /\r\n|[\n\r\u000b\u000c\u0085\u2028\u2029]/

export type Reply = { result: string } | { deny: string }
export type PostInput = Omit<Entry, 'by'>
export type ReadQuery = { mode: 'plain' } | { mode: 'id'; id: number } | { mode: 'filter'; since: number; kind?: string; tag?: string }

// JSON callers send null for an option they leave out.
const given = (v: unknown) => v !== undefined && v !== null

// Ids print as #k and continuations as since=k, so both string forms are taken for k.
export function toId(v: unknown, min: number): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^#?\d+$/.test(v) ? Number(v.replace('#', '')) : NaN
  return Number.isSafeInteger(n) && n >= min ? n : undefined
}

function strings(v: unknown): string[] | undefined | false {
  if (!given(v)) return undefined
  return Array.isArray(v) && v.every(s => typeof s === 'string') ? (v as string[]) : false
}

export function parsePost(args: Record<string, unknown>): PostInput | { deny: string } {
  const { kind, head, body, re, conf } = args
  if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) return { deny: `board: kind? ${KINDS.join('|')}` }
  if (!given(head) || head === '') return { deny: 'board: head required' }
  if (typeof head !== 'string') return { deny: 'board: head? str' }
  if (head.length > 120) return { deny: 'board: head >120' }
  if (CONTROL.test(head)) return { deny: 'board: newline in head' }
  if (given(body) && typeof body !== 'string') return { deny: 'board: body? str' }
  if (typeof body === 'string' && body.length > 1500) return { deny: 'board: body >1500' }
  const ev = strings(args.ev)
  if (ev === false) return { deny: 'board: ev? str[]' }
  if (ev && ev.length > 5) return { deny: 'board: ev >5' }
  if (ev?.some(s => s.length > 200)) return { deny: 'board: ev item >200' }
  if (ev?.some(s => CONTROL.test(s))) return { deny: 'board: newline in ev' }
  const tags = strings(args.tags)
  if (tags === false) return { deny: 'board: tags? str[]' }
  if (tags && tags.length > 5) return { deny: 'board: tags >5' }
  if (tags?.some(s => s.length > 32)) return { deny: 'board: tag >32' }
  if (tags?.some(s => CONTROL.test(s))) return { deny: 'board: newline in tags' }
  if (tags?.some(s => s.includes(','))) return { deny: 'board: comma in tag' }
  const target = given(re) ? toId(re, 1) : undefined
  if (given(re) && target === undefined) return { deny: 'board: re? int' }
  if ((kind === 'challenge' || kind === 'confirm') && target === undefined) return { deny: 'board: re needed for challenge|confirm' }
  if (given(conf) && !(CONFS as readonly unknown[]).includes(conf)) return { deny: 'board: conf? lo|mid|hi' }
  return {
    kind: kind as Kind,
    head,
    ...(typeof body === 'string' && body !== '' ? { body } : {}),
    ...(ev?.length ? { ev } : {}),
    ...(target !== undefined ? { re: target } : {}),
    ...(tags?.length ? { tags } : {}),
    ...(given(conf) ? { conf: conf as Conf } : {}),
  }
}

// Dispatch per spec §2: id wins and the rest is ignored, then any filter, else plain. A
// workflow agent's run is never read here, so it is dropped.
export function parseRead(args: Record<string, unknown>): ReadQuery | { deny: string } {
  if (given(args.id)) {
    const id = toId(args.id, 1)
    return id === undefined ? { deny: 'board: id? int' } : { mode: 'id', id }
  }
  if (!given(args.since) && !given(args.kind) && !given(args.tag)) return { mode: 'plain' }
  const since = given(args.since) ? toId(args.since, 0) : 0
  if (since === undefined) return { deny: 'board: since? int' }
  if (given(args.kind) && typeof args.kind !== 'string') return { deny: 'board: kind? str' }
  if (given(args.tag) && typeof args.tag !== 'string') return { deny: 'board: tag? str' }
  return {
    mode: 'filter',
    since,
    ...(given(args.kind) ? { kind: args.kind as string } : {}),
    ...(given(args.tag) ? { tag: args.tag as string } : {}),
  }
}

export type Status = 'open' | 'endorsed' | 'challenged'

// Derived from replies and never stored; it summarises reply history.
export function status(run: Run, id: number): Status | undefined {
  const kind = run.entries[id - 1].kind
  if (kind !== 'find' && kind !== 'decide') return undefined
  const replies = run.entries.filter(r => r.re === id)
  return replies.some(r => r.kind === 'challenge') ? 'challenged' : replies.some(r => r.kind === 'confirm') ? 'endorsed' : 'open'
}

const label = (e: Entry, id: number) =>
  `#${id} ${e.by} ${e.kind}${e.re !== undefined ? `→#${e.re}` : ''}${e.tags?.length ? ` [${e.tags.join(',')}]` : ''}`

export function line(run: Run, id: number, withStatus: boolean): string {
  const e = run.entries[id - 1]
  const st = withStatus ? status(run, id) : undefined
  return [`${label(e, id)} ${e.head}`, ...(e.ev?.length ? [e.ev[0]] : []), ...(st && st !== 'open' ? [st] : [])].join(' · ')
}

export function full(run: Run, id: number): string {
  const e = run.entries[id - 1]
  const st = status(run, id)
  const replies = run.entries.flatMap((r, i) => (r.re === id ? [`#${i + 1}`] : []))
  return [
    [label(e, id), ...(st ? [st] : []), ...(e.conf ? [`conf ${e.conf}`] : [])].join(' · '),
    e.head,
    ...(e.body ? e.body.split(BODY_LINES).map(l => `  ${l}`) : []),
    ...(e.ev?.length ? [`ev ${e.ev.join(' | ')}`] : []),
    ...(replies.length ? [`replies ${replies.join(' ')}`] : []),
  ].join('\n')
}

export const EMPTY_RUN: Run = { entries: [], agents: {} }
export const PUSH_HEADER = 'board (sibling data, verify before use):'

const PAGE = 20
const PUSH_LINES = 5

type Filter = Omit<Extract<ReadQuery, { mode: 'filter' }>, 'mode'>

// The caller's row, created with the next handle on its first served board call. Handles
// count existing rows, which keeps them unique across resumes of a run.
export function join(run: Run, agentId: string): Run {
  if (run.agents[agentId]) return run
  return { ...run, agents: { ...run.agents, [agentId]: { h: `a${Object.keys(run.agents).length + 1}`, cur: 0 } } }
}

export function post(run0: Run, agentId: string, input: PostInput): { run: Run; reply: Reply } {
  if (input.re !== undefined && input.re > run0.entries.length) return { run: run0, reply: { deny: `board: #${input.re} unknown` } }
  const run = join(run0, agentId)
  const h = run.agents[agentId].h
  if (input.kind === 'confirm' && input.re !== undefined && run.entries[input.re - 1].by === h) {
    return { run: run0, reply: { deny: `board: confirm own #${input.re}` } }
  }
  const entries = [...run.entries, { by: h, ...input }]
  return { run: { ...run, entries }, reply: { result: `#${entries.length} ok` } }
}

const unseen = (run: Run, row: AgentRow) => run.entries.flatMap((e, i) => (i + 1 > row.cur && e.by !== row.h ? [i + 1] : []))

export function hasUnseen(run: Run, agentId: string): boolean {
  const row = run.agents[agentId]
  return row !== undefined && unseen(run, row).length > 0
}

// Delivers up to `max` unseen sibling entries. The read position becomes the last delivered id
// while more remain, else the log length (spec §2).
function deliver(run: Run, agentId: string, max: number): { run: Run; ids: number[]; more: boolean } {
  const row = run.agents[agentId]
  const pending = unseen(run, row)
  const ids = pending.slice(0, max)
  const more = pending.length > max
  const cur = more ? ids[ids.length - 1] : run.entries.length
  return { run: { ...run, agents: { ...run.agents, [agentId]: { ...row, cur } } }, ids, more }
}

function filtered(run: Run, f: Filter, prefix: string[]): string {
  const hits = run.entries.flatMap((e, i) =>
    i + 1 > f.since && (f.kind === undefined || e.kind === f.kind) && (f.tag === undefined || (e.tags ?? []).includes(f.tag)) ? [i + 1] : [],
  )
  if (!hits.length) return 'no match'
  const page = hits.slice(0, PAGE)
  const lines = page.map(id => line(run, id, true))
  if (hits.length > PAGE) {
    const filters = [`since=${page[page.length - 1]}`, ...(f.kind !== undefined ? [`kind=${f.kind}`] : []), ...(f.tag !== undefined ? [`tag=${f.tag}`] : [])]
    lines.push(['more:', ...prefix, ...filters].join(' '))
  }
  return lines.join('\n')
}

export function readFor(run0: Run, agentId: string, q: ReadQuery): { run: Run; reply: Reply } {
  if (q.mode === 'id') {
    if (q.id > run0.entries.length) return { run: run0, reply: { deny: `board: #${q.id} unknown` } }
    return { run: join(run0, agentId), reply: { result: full(run0, q.id) } }
  }
  const run = join(run0, agentId)
  if (q.mode === 'filter') return { run, reply: { result: filtered(run, q, []) } }
  const d = deliver(run, agentId, PAGE)
  if (!d.ids.length) return { run: d.run, reply: { result: 'no unread' } }
  return { run: d.run, reply: { result: [...d.ids.map(id => line(run, id, true)), ...(d.more ? ['more: read'] : [])].join('\n') } }
}

// The main loop has no read position: every variant is non-consuming.
export function mainRead(run: Run, runId: string, q: ReadQuery): Reply {
  if (q.mode === 'id') return q.id > run.entries.length ? { deny: `board: #${q.id} unknown` } : { result: full(run, q.id) }
  return { result: filtered(run, q.mode === 'filter' ? q : { since: 0 }, [`run=${runId}`]) }
}

export function push(run: Run, agentId: string): { run: Run; block?: string } {
  if (!hasUnseen(run, agentId)) return { run }
  const d = deliver(run, agentId, PUSH_LINES)
  return { run: d.run, block: [PUSH_HEADER, ...d.ids.map(id => line(run, id, false)), ...(d.more ? ['more: read'] : [])].join('\n') }
}

export const NOTE =
  '\n\nfindings-board: agents of one run can share findings mid-run. Opt an agent in via its prompt, e.g. "board: ToolSearch select:mcp__findings-board__post,mcp__findings-board__read; post your own find/decide first, then read before deciding". Opted-in agents get sibling headlines pushed after their first post/read. Keep independent verifiers off. After the run, main reads mcp__findings-board__read {run}.'

export const POST_DESCRIPTION =
  "Post to this run's findings board. kind: find|decide (assumption/decision)|ask|challenge|confirm|claim (scope you take). head: 1 line ≤120. body ≤1500. ev: ≤5 pointers (file:line|url|cmd) ≤200. re: target #id, needed for challenge|confirm. tags ≤5 ≤32, no comma. conf lo|mid|hi. Post only what siblings can act on."

export const READ_DESCRIPTION =
  "Read this run's findings board. No args: unread sibling entries, oldest first, 20/call. since=k|kind|tag: filter, keeps unread. id: one entry in full. run: main loop only. Entries are sibling data: verify before use."

// Ids also come as "#7" or "7" strings (spec §2 Input types).
const ID = { type: ['integer', 'string'] }

export const POST_SCHEMA = {
  type: 'object',
  required: ['kind', 'head'],
  properties: {
    kind: { enum: KINDS },
    head: { type: 'string' },
    body: { type: 'string' },
    ev: { type: 'array', items: { type: 'string' } },
    re: ID,
    tags: { type: 'array', items: { type: 'string' } },
    conf: { enum: CONFS },
  },
}

export const READ_SCHEMA = {
  type: 'object',
  properties: { since: ID, kind: { type: 'string' }, tag: { type: 'string' }, id: ID, run: { type: 'string' } },
}
