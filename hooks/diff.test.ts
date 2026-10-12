import { describe, expect, test } from 'claude-code/testing'

import { isBinaryDiff, layout, nearestLine, parse, parseNumstat } from './diff'
import type { Run } from './diff'

const DIFF = [
  'diff --git a/a.txt b/a.txt',
  'index 111..222 100644',
  '--- a/a.txt',
  '+++ b/a.txt',
  '@@ -1,12 +1,13 @@',
  ' one',
  ' two',
  '-three',
  '+THREE',
  '+three and a half',
  ' four',
  ' five',
  ' six',
  ' seven',
  ' eight',
  ' nine',
  ' ten',
  ' eleven',
  '-twelve',
  '+TWELVE\r',
  '\\ No newline at end of file',
].join('\n')

const runs = (parts: ReturnType<typeof layout>['parts']) => parts.filter((part): part is Run => 'rows' in part)

describe('parse', () => {
  test('numbers added and kept lines by the new file and removed lines by the old', async () => {
    const rows = parse(DIFF)

    expect(rows.filter(row => row.kind === '+').map(row => row.n)).toEqual([3, 4, 13])
    expect(rows.filter(row => row.kind === '-').map(row => row.n)).toEqual([3, 12])
    expect(rows.find(row => row.text === 'four')?.n).toBe(5)
  })

  test('drops headers, the no-newline marker and carriage returns', async () => {
    const rows = parse(DIFF)

    expect(rows).toHaveLength(15)
    expect(rows[rows.length - 1]?.text).toBe('TWELVE')
  })

  test('turns tabs into spaces and removes control characters', async () => {
    const rows = parse('@@ -1 +1 @@\n+\tx\u0007y')

    expect(rows[0]?.text).toBe('    xy')
  })

  test('answers no rows for an empty or binary diff', async () => {
    expect(parse('')).toEqual([])
    expect(parse('diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ')).toEqual([])
    expect(isBinaryDiff('Binary files a/x.png and b/x.png differ')).toBe(true)
    expect(isBinaryDiff(DIFF)).toBe(false)
  })
})

describe('layout', () => {
  test('folds unchanged lines away from every change', async () => {
    const drawn = layout(parse(DIFF), null, [], 1, 400)
    const folds = drawn.parts.filter(part => 'fold' in part)

    expect(drawn.changes).toBe(2)
    expect(folds).toEqual([{ fold: 6, count: 6 }])
  })

  test('shows a stretch too short to be worth folding', async () => {
    const drawn = layout(parse(DIFF), null, [], 1, 400)

    expect(runs(drawn.parts)[0]?.rows.map(row => row.text)).toEqual(['one'])
  })

  test('expands a fold that was opened', async () => {
    const drawn = layout(parse(DIFF), null, [6], 1, 400)

    expect(drawn.parts.some(part => 'fold' in part)).toBe(false)
  })

  test('keeps an unchanged target line visible and marks it', async () => {
    const drawn = layout(parse(DIFF), 9, [], 1, 400)
    const target = runs(drawn.parts).find(run => run.isTarget)

    expect(drawn.hasTarget).toBe(true)
    expect(target?.rows.map(row => row.n)).toEqual([9])
  })

  test('marks a changed target line and still counts its change', async () => {
    const drawn = layout(parse(DIFF), 13, [], 1, 400)
    const target = runs(drawn.parts).find(run => run.isTarget)

    expect(target?.rows[0]?.kind).toBe('+')
    expect(drawn.changes).toBe(2)
  })

  test('never draws more rows than the limit and says how many it left out', async () => {
    const big = `@@ -0,0 +1,1000 @@\n${Array.from({ length: 1000 }, (_, i) => `+line ${i + 1}`).join('\n')}`
    const drawn = layout(parse(big), 900, [], 3, 100)
    const rows = runs(drawn.parts).flatMap(run => run.rows)

    expect(rows.length).toBeLessThanOrEqual(100)
    expect(drawn.hidden).toBe(1000 - rows.length)
    expect(rows.some(row => row.n === 900)).toBe(true)
  })
})

describe('nearestLine', () => {
  test('lands on the closest line that exists in the new file', async () => {
    const rows = parse(DIFF)

    expect(nearestLine(rows, 5)).toBe(5)
    expect(nearestLine(rows, 999)).toBe(13)
    expect(nearestLine([], 5)).toBe(null)
  })
})

describe('parseNumstat', () => {
  test('reads counts, binary files and paths with tabs or spaces', async () => {
    const stats = parseNumstat('3\t1\tsrc/a b.ts\u0000-\t-\timg/x.png\u00000\t7\tgone.txt\u0000')

    expect(stats).toEqual([
      { path: 'src/a b.ts', added: 3, removed: 1, isBinary: false },
      { path: 'img/x.png', added: 0, removed: 0, isBinary: true },
      { path: 'gone.txt', added: 0, removed: 7, isBinary: false },
    ])
  })
})
