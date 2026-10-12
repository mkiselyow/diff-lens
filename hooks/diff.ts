export type RowKind = ' ' | '+' | '-'
export type Row = { kind: RowKind; n: number; text: string }
export type Run = { rows: Row[]; change: number | null; isTarget: boolean }
export type Fold = { fold: number; count: number }
export type Part = Run | Fold
export type Layout = { parts: Part[]; changes: number; hidden: number; hasTarget: boolean }

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

export const layout = (rows: Row[], line: number | null, expanded: readonly number[], context: number, limit: number): Layout => {
  const isNear = rows.map(() => false)
  rows.forEach((row, i) => {
    if (row.kind === ' ' && !isTargetRow(row, line)) return
    for (let j = Math.max(0, i - context); j <= Math.min(rows.length - 1, i + context); j++) isNear[j] = true
  })
  const all: Part[] = []
  let changes = 0
  let i = 0
  while (i < rows.length) {
    const start = i
    const first = rows[i] as Row
    if (!isNear[i]) {
      while (i < rows.length && !isNear[i]) i++
      if (expanded.includes(start) || i - start < MIN_FOLD) all.push({ rows: rows.slice(start, i), change: null, isTarget: false })
      else all.push({ fold: start, count: i - start })
      continue
    }
    const startsChange = first.kind !== ' ' && (start === 0 || (rows[start - 1] as Row).kind === ' ')
    const change = startsChange ? changes++ : null
    if (isTargetRow(first, line)) {
      all.push({ rows: [first], change, isTarget: true })
      i++
      continue
    }
    while (i < rows.length && isNear[i] && (rows[i] as Row).kind === first.kind && !isTargetRow(rows[i] as Row, line)) i++
    all.push({ rows: rows.slice(start, i), change, isTarget: false })
  }
  const targetAt = all.findIndex(part => 'rows' in part && part.isTarget)
  const size = (part: Part) => ('rows' in part ? part.rows.length : 1)
  const total = all.reduce((sum, part) => sum + size(part), 0)
  if (total <= limit) return { parts: all, changes, hidden: 0, hasTarget: targetAt >= 0 }
  let from = 0
  if (targetAt >= 0) {
    let before = 0
    from = targetAt
    while (from > 0 && before + size(all[from - 1] as Part) <= limit / 2) before += size(all[--from] as Part)
  }
  const parts: Part[] = []
  let drawn = 0
  for (let at = from; at < all.length && drawn < limit; at++) {
    const part = all[at] as Part
    if ('rows' in part && drawn + part.rows.length > limit) {
      parts.push({ ...part, rows: part.rows.slice(0, limit - drawn) })
      drawn = limit
    } else {
      parts.push(part)
      drawn += size(part)
    }
  }

  return { parts, changes, hidden: total - drawn, hasTarget: targetAt >= 0 }
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
