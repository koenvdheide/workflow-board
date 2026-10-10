import type { Conf, Entry, Kind, Run } from '../types'

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
