import { describe, expect, test } from 'claude-code/testing'

import { fromHref, rewrite, splitLine, toRelative } from './links'

const CWD = '/repo'
const isChanged = (path: string) => path === 'src/a.ts' || path === 'my docs/b c.md'

describe('splitLine', () => {
  test('reads path:line, path:line:column and #L anchors', async () => {
    expect(splitLine('src/a.ts')).toEqual({ path: 'src/a.ts', line: null })
    expect(splitLine('src/a.ts:47')).toEqual({ path: 'src/a.ts', line: 47 })
    expect(splitLine('src/a.ts:47:3')).toEqual({ path: 'src/a.ts', line: 47 })
    expect(splitLine('src/a.ts#L12-L20')).toEqual({ path: 'src/a.ts', line: 12 })
  })
})

describe('toRelative', () => {
  test('accepts paths inside the working folder only', async () => {
    expect(toRelative('/repo/src/a.ts', CWD)).toBe('src/a.ts')
    expect(toRelative('./src/a.ts', CWD)).toBe('src/a.ts')
    expect(toRelative('/elsewhere/a.ts', CWD)).toBe(null)
  })
})

describe('rewrite', () => {
  test('points a link to a changed file at a file URL that carries the line', async () => {
    const out = rewrite('See [a.ts:47](src/a.ts:47).', CWD, isChanged)

    expect(out.changed).toBe(1)
    expect(out.hrefs).toEqual(['file:///repo/src/a.ts#L47'])
    expect(out.text).toBe('See [a.ts:47](file:///repo/src/a.ts#L47).')
    expect(fromHref(out.hrefs[0] ?? '', CWD)).toEqual({ path: 'src/a.ts', line: 47 })
  })

  test('reports no changed link when the reply links only unchanged files', async () => {
    const out = rewrite('See [other](src/other.ts:3).', CWD, isChanged)

    expect(out.changed).toBe(0)
  })

  test('leaves web links, anchors and code untouched', async () => {
    const text = 'A [site](https://example.com/src/a.ts) and [top](#top), `[x](src/a.ts)`\n```\n[y](src/a.ts)\n```'
    const out = rewrite(text, CWD, isChanged)

    expect(out.text).toBe(text)
    expect(out.changed).toBe(0)
  })

  test('survives paths with spaces written percent-encoded and absolute paths', async () => {
    const out = rewrite('[b](my%20docs/b%20c.md:2) [a](/repo/src/a.ts)', CWD, isChanged)

    expect(out.changed).toBe(2)
    expect(out.hrefs.map(href => fromHref(href, CWD))).toEqual([
      { path: 'my docs/b c.md', line: 2 },
      { path: 'src/a.ts', line: null },
    ])
  })

  test('lists a link written twice once', async () => {
    const out = rewrite('[a](src/a.ts) and again [a](src/a.ts)', CWD, isChanged)

    expect(out.hrefs).toHaveLength(1)
    expect(out.changed).toBe(2)
  })
})
