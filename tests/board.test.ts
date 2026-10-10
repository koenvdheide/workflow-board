import { describe, expect, test } from 'claude-code/testing'

import { full, line, parsePost, parseRead, status, toId } from '../hooks/board'
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
