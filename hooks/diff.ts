export type RowKind = ' ' | '+' | '-'
export type Row = { kind: RowKind; n: number; text: string }
export type Run = { rows: Row[]; change: number | null; isTarget: boolean }
export type Fold = { fold: number; count: number }
export type Part = Run | Fold
export type Layout = { parts: Part[]; changes: number; changeAt: number[]; start: number; before: number; hidden: number; hasTarget: boolean }

type Item = Fold | { row: Row; change: number | null; isTarget: boolean }

const MIN_FOLD = 3
const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)/
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g

export const clean = (text: string): string => text.replace(/\r$/, '').replace(/\t/g, '    ').replace(CONTROL, '')

export const parse = (diff: string): Row[] => {
  const rows: Row[] = []
  let oldN = 0
  let newN = 0
  let isInHunk = false
  for (const raw of diff.split('\n')) {
    const hunk = HUNK.exec(raw)
    if (hunk) {
      oldN = Number(hunk[1])
      newN = Number(hunk[2])
      isInHunk = true
    } else if (!isInHunk) continue
    else if (raw.startsWith('+')) rows.push({ kind: '+', n: newN++, text: clean(raw.slice(1)) })
    else if (raw.startsWith('-')) rows.push({ kind: '-', n: oldN++, text: clean(raw.slice(1)) })
    else if (raw.startsWith(' ')) {
      rows.push({ kind: ' ', n: newN++, text: clean(raw.slice(1)) })
      oldN++
    } else if (raw.startsWith('diff --git ')) isInHunk = false
  }

  return rows
}

export const isBinaryDiff = (diff: string): boolean => /^Binary files .* differ$/m.test(diff) || /^GIT binary patch$/m.test(diff)

const isTargetRow = (row: Row, line: number | null): boolean => line !== null && row.kind !== '-' && row.n === line

export const nearestLine = (rows: Row[], line: number): number | null => {
  let best: number | null = null
  for (const row of rows) {
    if (row.kind === '-') continue
    if (best === null || Math.abs(row.n - line) < Math.abs(best - line)) best = row.n
  }

  return best
}

export const layout = (
  rows: Row[],
  line: number | null,
  expanded: readonly number[],
  context: number,
  limit: number,
  start: number | null = null,
): Layout => {
  const isNear = rows.map(() => false)
  rows.forEach((row, i) => {
    if (row.kind === ' ' && !isTargetRow(row, line)) return
    for (let j = Math.max(0, i - context); j <= Math.min(rows.length - 1, i + context); j++) isNear[j] = true
  })
  const items: Item[] = []
  const changeAt: number[] = []
  let targetAt = -1
  let openUntil = 0
  let i = 0
  while (i < rows.length) {
    const from = i
    if (!isNear[i] && i >= openUntil) {
      while (i < rows.length && !isNear[i]) i++
      if (!expanded.includes(from) && i - from >= MIN_FOLD) {
        items.push({ fold: from, count: i - from })
        continue
      }
      openUntil = i
      i = from
    }
    const row = rows[i] as Row
    const startsChange = row.kind !== ' ' && (i === 0 || (rows[i - 1] as Row).kind === ' ')
    const isTarget = isTargetRow(row, line)
    if (startsChange) changeAt.push(items.length)
    if (isTarget) targetAt = items.length
    items.push({ row, change: startsChange ? changeAt.length - 1 : null, isTarget })
    i++
  }
  const total = items.length
  const first =
    total <= limit ? 0 : Math.max(0, Math.min(total - limit, start !== null ? start : targetAt >= 0 ? targetAt - Math.floor(limit / 2) : 0))
  const shown = items.slice(first, first + limit)
  const parts: Part[] = []
  for (const item of shown) {
    const last = parts[parts.length - 1]
    if ('fold' in item) parts.push(item)
    else if (last !== undefined && 'rows' in last && !last.isTarget && !item.isTarget && item.change === null && (last.rows[0] as Row).kind === item.row.kind)
      last.rows.push(item.row)
    else parts.push({ rows: [item.row], change: item.change, isTarget: item.isTarget })
  }

  return { parts, changes: changeAt.length, changeAt, start: first, before: first, hidden: total - first - shown.length, hasTarget: targetAt >= first && targetAt < first + limit }
}

export const parseNumstat = (out: string): { path: string; added: number; removed: number; isBinary: boolean }[] =>
  out
    .split('\u0000')
    .filter(Boolean)
    .map(entry => {
      const [added = '', removed = '', ...path] = entry.split('\t')

      return { path: path.join('\t'), added: Number(added) || 0, removed: Number(removed) || 0, isBinary: added === '-' && removed === '-' }
    })
    .filter(stat => stat.path !== '')
