import { describe, expect, test } from 'claude-code/testing'

import { EMPTY_RUN, PUSH_HEADER, full, hasUnseen, join, line, mainRead, parsePost, parseRead, post, push, readFor, status, toId } from '../hooks/board'
import type { Entry, Run } from '../types'

const long = (n: number) => 'x'.repeat(n)

describe('toId', () => {
  test('takes integers and the #k and k string forms', () => {
    expect(toId(7, 1)).toBe(7)
    expect(toId('#7', 1)).toBe(7)
    expect(toId('7', 1)).toBe(7)
    expect(toId(0, 0)).toBe(0)
    expect(toId(1000000000, 0)).toBe(1000000000)
    expect(toId('1000000000', 0)).toBe(1000000000)
    expect(toId('#1000000000', 0)).toBe(1000000000)
  })

  test('refuses other forms and values below the minimum', () => {
    expect(toId(0, 1)).toBeUndefined()
    expect(toId(-1, 0)).toBeUndefined()
    expect(toId(1.5, 1)).toBeUndefined()
    expect(toId('x', 1)).toBeUndefined()
    expect(toId('#', 1)).toBeUndefined()
    expect(toId(true, 1)).toBeUndefined()
    expect(toId('99999999999999999999', 0)).toBeUndefined()
  })
})

describe('parsePost', () => {
  test('a minimal find passes and absent options stay absent', () => {
    expect(parsePost({ kind: 'find', head: 'h' })).toEqual({ kind: 'find', head: 'h' })
    expect(parsePost({ kind: 'find', head: 'h', body: null, ev: null, re: null, tags: null, conf: null })).toEqual({ kind: 'find', head: 'h' })
  })

  test('keeps every field it is given', () => {
    expect(parsePost({ kind: 'challenge', head: 'h', body: 'b\nc', ev: ['a.ts:1'], re: '#3', tags: ['auth'], conf: 'hi' })).toEqual({
      kind: 'challenge', head: 'h', body: 'b\nc', ev: ['a.ts:1'], re: 3, tags: ['auth'], conf: 'hi',
    })
  })

  test('refuses a missing or unknown kind', () => {
    expect(parsePost({ head: 'h' })).toEqual({ deny: 'board: kind? find|decide|ask|challenge|confirm|claim' })
    expect(parsePost({ kind: 'note', head: 'h' })).toEqual({ deny: 'board: kind? find|decide|ask|challenge|confirm|claim' })
  })

  test('refuses a missing, empty or non-string head', () => {
    expect(parsePost({ kind: 'find' })).toEqual({ deny: 'board: head required' })
    expect(parsePost({ kind: 'find', head: '' })).toEqual({ deny: 'board: head required' })
    expect(parsePost({ kind: 'find', head: 5 })).toEqual({ deny: 'board: head? str' })
  })

  test('each limit holds at its boundary and refuses one over', () => {
    expect(parsePost({ kind: 'find', head: long(120) })).not.toHaveProperty('deny')
    expect(parsePost({ kind: 'find', head: long(121) })).toEqual({ deny: 'board: head >120' })
    expect(parsePost({ kind: 'find', head: 'h', body: long(1500) })).not.toHaveProperty('deny')
    expect(parsePost({ kind: 'find', head: 'h', body: long(1501) })).toEqual({ deny: 'board: body >1500' })
    expect(parsePost({ kind: 'find', head: 'h', ev: ['1', '2', '3', '4', '5'] })).not.toHaveProperty('deny')
    expect(parsePost({ kind: 'find', head: 'h', ev: ['1', '2', '3', '4', '5', '6'] })).toEqual({ deny: 'board: ev >5' })
    expect(parsePost({ kind: 'find', head: 'h', ev: [long(200)] })).not.toHaveProperty('deny')
    expect(parsePost({ kind: 'find', head: 'h', ev: [long(201)] })).toEqual({ deny: 'board: ev item >200' })
    expect(parsePost({ kind: 'find', head: 'h', tags: ['a', 'b', 'c', 'd', 'e'] })).not.toHaveProperty('deny')
    expect(parsePost({ kind: 'find', head: 'h', tags: ['a', 'b', 'c', 'd', 'e', 'f'] })).toEqual({ deny: 'board: tags >5' })
    expect(parsePost({ kind: 'find', head: 'h', tags: [long(32)] })).not.toHaveProperty('deny')
    expect(parsePost({ kind: 'find', head: 'h', tags: [long(33)] })).toEqual({ deny: 'board: tag >32' })
  })

  test('single-line fields refuse newlines and control characters', () => {
    expect(parsePost({ kind: 'find', head: 'a\nb' })).toEqual({ deny: 'board: newline in head' })
    expect(parsePost({ kind: 'find', head: 'a\tb' })).toEqual({ deny: 'board: newline in head' })
    expect(parsePost({ kind: 'find', head: 'h', ev: ['a\nb'] })).toEqual({ deny: 'board: newline in ev' })
    expect(parsePost({ kind: 'find', head: 'h', tags: ['a\u0007'] })).toEqual({ deny: 'board: newline in tags' })
  })

  test('C1 controls and Unicode line separators count as newlines', () => {
    expect(parsePost({ kind: 'find', head: 'a\u0085b' })).toEqual({ deny: 'board: newline in head' })
    expect(parsePost({ kind: 'find', head: 'h', ev: ['a\u2028b'] })).toEqual({ deny: 'board: newline in ev' })
    expect(parsePost({ kind: 'find', head: 'h', tags: ['a\u2029b'] })).toEqual({ deny: 'board: newline in tags' })
  })

  test('refuses a comma in a tag', () => {
    expect(parsePost({ kind: 'find', head: 'h', tags: ['auth,api'] })).toEqual({ deny: 'board: comma in tag' })
  })

  test('refuses wrong types', () => {
    expect(parsePost({ kind: 'find', head: 'h', body: 5 })).toEqual({ deny: 'board: body? str' })
    expect(parsePost({ kind: 'find', head: 'h', ev: 'a.ts:1' })).toEqual({ deny: 'board: ev? str[]' })
    expect(parsePost({ kind: 'find', head: 'h', tags: [1] })).toEqual({ deny: 'board: tags? str[]' })
    expect(parsePost({ kind: 'find', head: 'h', re: 'x' })).toEqual({ deny: 'board: re? int' })
    expect(parsePost({ kind: 'find', head: 'h', re: 0 })).toEqual({ deny: 'board: re? int' })
    expect(parsePost({ kind: 'find', head: 'h', conf: 'max' })).toEqual({ deny: 'board: conf? lo|mid|hi' })
  })

  test('challenge and confirm need re; other kinds do not', () => {
    expect(parsePost({ kind: 'challenge', head: 'h' })).toEqual({ deny: 'board: re needed for challenge|confirm' })
    expect(parsePost({ kind: 'confirm', head: 'h' })).toEqual({ deny: 'board: re needed for challenge|confirm' })
    expect(parsePost({ kind: 'find', head: 'h', re: 2 })).toEqual({ kind: 'find', head: 'h', re: 2 })
  })

  test('ignores unknown fields', () => {
    expect(parsePost({ kind: 'ask', head: 'h', extra: 1 })).toEqual({ kind: 'ask', head: 'h' })
  })
})

describe('parseRead', () => {
  test('no option, or only run, is a plain read', () => {
    expect(parseRead({})).toEqual({ mode: 'plain' })
    expect(parseRead({ run: 'wf_1' })).toEqual({ mode: 'plain' })
    expect(parseRead({ id: null, since: null, kind: null, tag: null })).toEqual({ mode: 'plain' })
  })

  test('id wins over filters, which are then not validated', () => {
    expect(parseRead({ id: '#2', since: 'bad', kind: 3 })).toEqual({ mode: 'id', id: 2 })
    expect(parseRead({ id: 0 })).toEqual({ deny: 'board: id? int' })
  })

  test('filters combine and since defaults to 0', () => {
    expect(parseRead({ tag: 'auth' })).toEqual({ mode: 'filter', since: 0, tag: 'auth' })
    expect(parseRead({ since: '7', kind: 'find' })).toEqual({ mode: 'filter', since: 7, kind: 'find' })
  })

  test('refuses wrong filter types', () => {
    expect(parseRead({ since: -1 })).toEqual({ deny: 'board: since? int' })
    expect(parseRead({ kind: 3 })).toEqual({ deny: 'board: kind? str' })
    expect(parseRead({ tag: ['a'] })).toEqual({ deny: 'board: tag? str' })
  })
})

const e = (o: Partial<Entry> = {}): Entry => ({ by: 'a1', kind: 'find', head: 'h', ...o })
const runOf = (...entries: Entry[]): Run => ({ entries, agents: {} })

describe('status', () => {
  test('a challenge reply beats a confirm', () => {
    const run = runOf(e(), e({ by: 'a2', kind: 'confirm', re: 1 }), e({ by: 'a3', kind: 'challenge', re: 1 }))
    expect(status(run, 1)).toBe('challenged')
  })

  test('a confirm alone endorses; a neutral reply leaves open', () => {
    expect(status(runOf(e(), e({ by: 'a2', kind: 'confirm', re: 1 })), 1)).toBe('endorsed')
    expect(status(runOf(e(), e({ by: 'a2', kind: 'find', re: 1 })), 1)).toBe('open')
  })

  test('decide has status; other kinds have none', () => {
    expect(status(runOf(e({ kind: 'decide' })), 1)).toBe('open')
    expect(status(runOf(e({ kind: 'ask' })), 1)).toBeUndefined()
    expect(status(runOf(e({ kind: 'claim' })), 1)).toBeUndefined()
  })
})

describe('rendering', () => {
  const run = runOf(
    e({ by: 'a3', head: 'jwt exp unchecked', tags: ['auth', 'api'], ev: ['src/auth.ts:88', 'src/auth.ts:102'], conf: 'hi', body: 'line one\nline two' }),
    e({ by: 'a5', kind: 'challenge', re: 1, head: 'exp checked in middleware', ev: ['src/mw.ts:41'] }),
    e({ by: 'a1', kind: 'ask', head: 'how is session ttl set?' }),
  )

  test('read lines carry the first ev and a non-open status', () => {
    expect(line(run, 1, true)).toBe('#1 a3 find [auth,api] jwt exp unchecked · src/auth.ts:88 · challenged')
    expect(line(run, 2, true)).toBe('#2 a5 challenge→#1 exp checked in middleware · src/mw.ts:41')
    expect(line(run, 3, true)).toBe('#3 a1 ask how is session ttl set?')
  })

  test('an open find shows no status on its read line', () => {
    expect(line(runOf(e()), 1, true)).toBe('#1 a1 find h')
  })

  test('the full entry shows status, confidence, indented body, every ev and reply ids', () => {
    expect(full(run, 1)).toBe('#1 a3 find [auth,api] · challenged · conf hi\njwt exp unchecked\n  line one\n  line two\nev src/auth.ts:88 | src/auth.ts:102\nreplies #2')
    expect(full(run, 2)).toBe('#2 a5 challenge→#1\nexp checked in middleware\nev src/mw.ts:41')
    expect(full(runOf(e()), 1)).toBe('#1 a1 find · open\nh')
  })

  test('every line terminator in a body starts an indented line', () => {
    const body = 'a\r\nb\rc\u000bd\u000ce\u0085f\u2028g\u2029h'
    expect(full(runOf(e({ body })), 1)).toBe(['#1 a1 find · open', 'h', ...'abcdefgh'.split('').map(l => `  ${l}`)].join('\n'))
  })
})

// `n` sibling entries by a1, then the given extra entries.
const siblings = (n: number, ...extra: Entry[]): Entry[] => [...Array.from({ length: n }, (_, i) => e({ head: `s${i + 1}` })), ...extra]
const withAgents = (entries: Entry[], agents: Run['agents']): Run => ({ entries, agents })

describe('post', () => {
  test('appends with the next id and allocates handles in first-use order', () => {
    const one = post(EMPTY_RUN, 'ag1', { kind: 'find', head: 'h' })
    expect(one.reply).toEqual({ result: '#1 ok' })
    expect(one.run).toEqual({ entries: [{ by: 'a1', kind: 'find', head: 'h' }], agents: { ag1: { h: 'a1', cur: 0 } } })
    const two = post(one.run, 'ag2', { kind: 'ask', head: 'q' })
    expect(two.reply).toEqual({ result: '#2 ok' })
    expect(two.run.entries[1].by).toBe('a2')
  })

  test('refuses an unknown re and confirming its own entry, changing nothing', () => {
    const one = post(EMPTY_RUN, 'ag1', { kind: 'find', head: 'h' }).run
    const unknown = post(one, 'ag2', { kind: 'challenge', head: 'x', re: 5 })
    expect(unknown.reply).toEqual({ deny: 'board: #5 unknown' })
    expect(unknown.run).toBe(one)
    const own = post(one, 'ag1', { kind: 'confirm', head: 'x', re: 1 })
    expect(own.reply).toEqual({ deny: 'board: confirm own #1' })
    expect(own.run).toBe(one)
    expect(post(one, 'ag2', { kind: 'confirm', head: 'x', re: 1 }).reply).toEqual({ result: '#2 ok' })
  })

  test('a post re-applied to a newer state takes the next id', () => {
    const one = post(EMPTY_RUN, 'ag1', { kind: 'find', head: 'h' }).run
    const newer = post(one, 'ag2', { kind: 'find', head: 'other' }).run
    expect(post(newer, 'ag1', { kind: 'find', head: 'mine' }).reply).toEqual({ result: '#3 ok' })
  })

  test('handles follow first use when first uses interleave', () => {
    const run = join(join(EMPTY_RUN, 'y'), 'x')
    expect(run.agents).toEqual({ y: { h: 'a1', cur: 0 }, x: { h: 'a2', cur: 0 } })
    expect(join(run, 'x')).toBe(run)
  })
})

describe('readFor', () => {
  test('a plain read pages sibling entries, skips own ones and moves the read position', () => {
    const run = withAgents(siblings(21, e({ by: 'a2', head: 'mine' })), { ag1: { h: 'a1', cur: 0 }, ag2: { h: 'a2', cur: 0 } })
    const first = readFor(run, 'ag2', { mode: 'plain' })
    const lines = (first.reply as { result: string }).result.split('\n')
    expect(lines.length).toBe(21)
    expect(lines[0]).toBe('#1 a1 find s1')
    expect(lines[19]).toBe('#20 a1 find s20')
    expect(lines[20]).toBe('more: read')
    expect(first.run.agents.ag2.cur).toBe(20)
    const second = readFor(first.run, 'ag2', { mode: 'plain' })
    expect(second.reply).toEqual({ result: '#21 a1 find s21' })
    expect(second.run.agents.ag2.cur).toBe(22)
    expect(readFor(second.run, 'ag2', { mode: 'plain' }).reply).toEqual({ result: 'no unread' })
  })

  test('a first read creates the agent row', () => {
    const out = readFor(EMPTY_RUN, 'agX', { mode: 'plain' })
    expect(out.reply).toEqual({ result: 'no unread' })
    expect(out.run.agents.agX).toEqual({ h: 'a1', cur: 0 })
  })

  test('the delivery comes from the state the transition was applied to', () => {
    const entries = siblings(3)
    const at0 = readFor(withAgents(entries, { ag2: { h: 'a2', cur: 0 } }), 'ag2', { mode: 'plain' })
    const at1 = readFor(withAgents(entries, { ag2: { h: 'a2', cur: 1 } }), 'ag2', { mode: 'plain' })
    expect(at0.reply).toEqual({ result: '#1 a1 find s1\n#2 a1 find s2\n#3 a1 find s3' })
    expect(at1.reply).toEqual({ result: '#2 a1 find s2\n#3 a1 find s3' })
  })

  test('a filtered read includes own entries, ANDs filters, excludes since and keeps the position', () => {
    const run = withAgents([e({ tags: ['auth'] }), e({ by: 'a2', tags: ['auth'] }), e({ by: 'a2', kind: 'ask', tags: ['auth'] }), e({ tags: ['db'] })], { ag2: { h: 'a2', cur: 0 } })
    const out = readFor(run, 'ag2', { mode: 'filter', since: 1, kind: 'find', tag: 'auth' })
    expect(out.reply).toEqual({ result: '#2 a2 find [auth] h' })
    expect(out.run.agents.ag2.cur).toBe(0)
    expect(readFor(run, 'ag2', { mode: 'filter', since: 0, tag: 'none' }).reply).toEqual({ result: 'no match' })
  })

  test('a filtered continuation repeats the filters', () => {
    const run = withAgents(Array.from({ length: 21 }, () => e({ tags: ['auth'] })), { ag2: { h: 'a2', cur: 0 } })
    const text = (readFor(run, 'ag2', { mode: 'filter', since: 0, kind: 'find', tag: 'auth' }).reply as { result: string }).result
    expect(text.split('\n').at(-1)).toBe('more: since=20 kind=find tag=auth')
  })

  test('a filtered page of exactly 20 has no continuation', () => {
    const run = withAgents(Array.from({ length: 20 }, () => e({ tags: ['auth'] })), { ag2: { h: 'a2', cur: 0 } })
    const lines = (readFor(run, 'ag2', { mode: 'filter', since: 0, tag: 'auth' }).reply as { result: string }).result.split('\n')
    expect(lines.length).toBe(20)
    expect(lines[19]).toBe('#20 a1 find [auth] h')
  })

  test('a filtered first read creates the agent row', () => {
    const out = readFor(EMPTY_RUN, 'agX', { mode: 'filter', since: 0 })
    expect(out.reply).toEqual({ result: 'no match' })
    expect(out.run.agents.agX).toEqual({ h: 'a1', cur: 0 })
  })

  test('read {id} gives the full entry or refuses an unknown id unchanged', () => {
    const run = withAgents([e()], { ag1: { h: 'a1', cur: 0 } })
    const out = readFor(run, 'ag2', { mode: 'id', id: 1 })
    expect(out.reply).toEqual({ result: '#1 a1 find · open\nh' })
    expect(out.run.agents.ag2).toEqual({ h: 'a2', cur: 0 })
    const unknown = readFor(run, 'ag2', { mode: 'id', id: 9 })
    expect(unknown.reply).toEqual({ deny: 'board: #9 unknown' })
    expect(unknown.run).toBe(run)
  })
})

describe('mainRead', () => {
  test('pages every entry from #1 with continuations that carry run', () => {
    const run = withAgents(siblings(21), {})
    const text = (mainRead(run, 'wf_1', { mode: 'plain' }) as { result: string }).result
    expect(text.split('\n')[0]).toBe('#1 a1 find s1')
    expect(text.split('\n').at(-1)).toBe('more: run=wf_1 since=20')
    expect(mainRead(run, 'wf_1', { mode: 'filter', since: 20 })).toEqual({ result: '#21 a1 find s21' })
  })

  test('gives a full entry by id and refuses an unknown id', () => {
    const run = withAgents([e()], {})
    expect(mainRead(run, 'wf_1', { mode: 'id', id: 1 })).toEqual({ result: '#1 a1 find · open\nh' })
    expect(mainRead(run, 'wf_1', { mode: 'id', id: 2 })).toEqual({ deny: 'board: #2 unknown' })
  })
})

describe('push', () => {
  test('nothing for an agent without a row or with nothing unseen', () => {
    const run = withAgents(siblings(2), { ag2: { h: 'a2', cur: 2 } })
    expect(push(run, 'agX')).toEqual({ run })
    expect(push(run, 'agX').run).toBe(run)
    expect(push(run, 'ag2').run).toBe(run)
    expect(hasUnseen(run, 'ag2')).toBe(false)
    expect(hasUnseen(run, 'agX')).toBe(false)
  })

  test('at most 5 lines, oldest first, more exactly when a 6th is waiting', () => {
    const run = withAgents(siblings(7), { ag2: { h: 'a2', cur: 0 } })
    expect(hasUnseen(run, 'ag2')).toBe(true)
    const first = push(run, 'ag2')
    expect(first.block).toBe([PUSH_HEADER, '#1 a1 find s1', '#2 a1 find s2', '#3 a1 find s3', '#4 a1 find s4', '#5 a1 find s5', 'more: read'].join('\n'))
    expect(first.run.agents.ag2.cur).toBe(5)
    const second = push(first.run, 'ag2')
    expect(second.block).toBe([PUSH_HEADER, '#6 a1 find s6', '#7 a1 find s7'].join('\n'))
    expect(second.run.agents.ag2.cur).toBe(7)
  })

  test('skips own entries and shows neither status nor confidence', () => {
    const run = withAgents(
      [e({ by: 'a2', head: 'mine' }), e({ head: 'f', conf: 'hi', ev: ['a.ts:1'] }), e({ by: 'a3', kind: 'challenge', re: 2, head: 'no' })],
      { ag2: { h: 'a2', cur: 0 } },
    )
    expect(push(run, 'ag2').block).toBe([PUSH_HEADER, '#2 a1 find f · a.ts:1', '#3 a3 challenge→#2 no'].join('\n'))
  })

  test('exactly 5 unseen gives no more line', () => {
    const run = withAgents(siblings(5), { ag2: { h: 'a2', cur: 0 } })
    expect(push(run, 'ag2').block?.split('\n').at(-1)).toBe('#5 a1 find s5')
  })

  test('while more wait, the read position is the last delivered id', () => {
    const run = withAgents([e({ by: 'a2', head: 'mine' }), ...siblings(6)], { ag2: { h: 'a2', cur: 0 } })
    const out = push(run, 'ag2')
    expect(out.block).toBe([PUSH_HEADER, '#2 a1 find s1', '#3 a1 find s2', '#4 a1 find s3', '#5 a1 find s4', '#6 a1 find s5', 'more: read'].join('\n'))
    expect(out.run.agents.ag2.cur).toBe(6)
  })
})
