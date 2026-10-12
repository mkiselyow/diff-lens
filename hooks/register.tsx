import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FileStat, LensView } from '../types'
import { isBinaryDiff, layout, nearestLine, parse, parseNumstat } from './diff'
import type { Layout, Row, Run } from './diff'
import { fromHref, rewrite, splitLine, toRelative } from './links'

const NAME = 'diff-lens'
const PANE = 'diff-lens'
const TITLE = 'Diff lens'
const TARGET = 'target'
const CONTEXT = 3
const ROW_LIMIT = 400
const PANE_COLUMNS = 150
const FULL_CONTEXT = '-U100000'
const FALLBACK_BASES = ['origin/main', 'origin/master', 'origin/develop', 'origin/release', 'main', 'master']
const EMPTY: LensView = {
  base: '',
  mergeBase: '',
  bases: [],
  stats: [],
  file: null,
  line: null,
  isFlashing: false,
  diff: '',
  isTruncated: false,
  status: 'idle',
  message: '',
  isListOpen: true,
  isBasePickerOpen: false,
  expanded: [],
  change: -1,
  shown: 0,
}
const view = atom({ plugin: 'diff-lens', key: 'view' } as const, EMPTY)

const samples: { name: string; ms: number }[] = []
const memo: { key: string; rows: Row[]; drawn: Layout } = { key: '', rows: [], drawn: { parts: [], changes: 0, hidden: 0, hasTarget: false } }
const settings = { base: '' }
let isRefreshQueued = false
let opens = 0

const record = (name: string, ms: number) => {
  samples.push({ name, ms })
  if (samples.length > 400) samples.splice(0, samples.length - 400)
}

const summarize = (): string => {
  const names = [...new Set(samples.map(sample => sample.name))]
  if (names.length === 0) return 'diff-lens: no timings recorded yet.'

  return names
    .map(name => {
      const list = samples.filter(sample => sample.name === name).map(sample => sample.ms).sort((a, b) => a - b)
      const pick = (share: number) => list[Math.min(list.length - 1, Math.floor(list.length * share))] ?? 0

      return `${name}: n=${list.length} median=${pick(0.5)}ms p95=${pick(0.95)}ms max=${list[list.length - 1] ?? 0}ms`
    })
    .join('\n')
}

const current = async ($: EngineInterface): Promise<LensView> => ({ ...EMPTY, ...(await read($, view)) })

const patch = ($: EngineInterface, change: Partial<LensView>) => update($, view, v => ({ ...EMPTY, ...v, ...change }))

const git = async ($: EngineInterface, name: string, args: string[]) => {
  const cwd = await $.session.cwd()
  const startedAt = await $.clock.now()
  try {
    const ran = await $.process.run(['git', '--no-pager', '-c', 'core.quotepath=off', ...args], { cwd, timeoutMs: 20000 })
    record(`git ${name}`, (await $.clock.now()) - startedAt)

    return { code: ran.exitCode, out: ran.stdout, err: ran.stderr.trim(), isTruncated: ran.isStdoutTruncated === true }
  } catch (error) {
    return { code: -1, out: '', err: String(error), isTruncated: false }
  }
}

const exists = async ($: EngineInterface, ref: string) => (await git($, 'verify', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])).code === 0

const findBases = async ($: EngineInterface, preferred: string): Promise<string[]> => {
  const head = await git($, 'origin-head', ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
  const upstream = await git($, 'upstream', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
  const wanted = [preferred, settings.base, head.code === 0 ? head.out.trim() : '', ...FALLBACK_BASES, upstream.code === 0 ? upstream.out.trim() : '']
  const bases: string[] = []
  for (const ref of wanted) {
    if (ref !== '' && !bases.includes(ref) && (await exists($, ref))) bases.push(ref)
  }

  return bases
}

const refresh = async ($: EngineInterface, wanted?: string): Promise<LensView> => {
  const before = await current($)
  const inside = await git($, 'inside', ['rev-parse', '--is-inside-work-tree'])
  if (inside.code !== 0) {
    await patch($, { status: 'error', message: 'This folder is not a git repository.', stats: [], bases: [] })

    return current($)
  }
  const bases = await findBases($, wanted ?? before.base)
  const base = wanted !== undefined && bases.includes(wanted) ? wanted : before.base !== '' && bases.includes(before.base) ? before.base : bases[0]
  if (wanted !== undefined && !bases.includes(wanted)) {
    await patch($, { bases, message: `Base "${wanted}" was not found; still comparing against ${before.base || 'nothing'}.` })

    return current($)
  }
  if (base === undefined) {
    await patch($, { status: 'error', message: 'No base branch found. Set one with /diff-lens base <ref>.', stats: [], bases })

    return current($)
  }
  const merge = await git($, 'merge-base', ['merge-base', base, 'HEAD'])
  const mergeBase = merge.code === 0 ? merge.out.trim() : base
  const tracked = await git($, 'numstat', ['diff', '--numstat', '-z', '--no-renames', mergeBase])
  const others = await git($, 'untracked', ['ls-files', '--others', '--exclude-standard', '-z'])
  const stats: FileStat[] = parseNumstat(tracked.out).map(stat => ({ ...stat, isUntracked: false }))
  for (const path of others.out.split('\u0000').filter(Boolean).slice(0, 200)) {
    stats.push({ path, added: 0, removed: 0, isBinary: false, isUntracked: true })
  }
  const message = merge.code === 0 ? '' : `No common ancestor with ${base}; comparing the two directly.`
  await patch($, { base, mergeBase, bases, stats, message, status: before.status === 'error' ? 'idle' : before.status })

  return current($)
}

const loadDiff = async ($: EngineInterface, v: LensView, path: string) => {
  const stat = v.stats.find(one => one.path === path)
  const ran = stat?.isUntracked
    ? await git($, 'diff untracked', ['diff', '--no-index', FULL_CONTEXT, '--', '/dev/null', path])
    : await git($, 'diff', ['diff', '--no-renames', FULL_CONTEXT, v.mergeBase, '--', path])
  const isFailed = ran.code !== 0 && !(stat?.isUntracked && ran.code === 1)

  return { ...ran, isFailed, stat }
}

const measure = (v: LensView): { rows: Row[]; drawn: Layout } => {
  const key = `${v.diff.length}:${v.line}:${v.expanded.join(',')}:${v.file}:${v.mergeBase}`
  if (memo.key !== key || memo.rows.length === 0) {
    memo.key = key
    memo.rows = parse(v.diff)
    memo.drawn = layout(memo.rows, v.line, v.expanded, CONTEXT, ROW_LIMIT)
  }

  return memo
}

const reveal = async ($: EngineInterface, key: string): Promise<boolean> => {
  const toKey = async () => {
    const moved = await $.ui.scroll({ in: PANE, to: { key }, block: 'center' })

    return !('deny' in moved && moved.deny)
  }
  const nudges: [string, ('start' | 'end')[]][] = [
    ['direct', []],
    ['end nudge', ['end']],
    ['end+start nudge', ['end', 'start']],
  ]
  await $.clock.sleep(120)
  for (const [name, edges] of nudges) {
    for (const edge of edges) {
      await $.ui.scroll({ in: PANE, to: edge })
      await $.clock.sleep(90)
    }
    if (await toKey()) {
      record(`scroll: ${name}`, 0)
      if (edges.length > 0) {
        await $.clock.sleep(180)
        await toKey()
      }

      return true
    }
  }
  record('scroll: failed', 0)

  return false
}

const flash = async ($: EngineInterface, mine: number, landed: number) => {
  const isShown = await reveal($, TARGET)
  if (mine !== opens) return
  if (!isShown) await patch($, { message: `Could not scroll to line ${landed}; it is marked with ▸.` })
  await $.clock.sleep(1200)
  if (mine === opens) await patch($, { isFlashing: false })
}

const openFile = async ($: EngineInterface, path: string, line: number | null) => {
  const mine = ++opens
  const startedAt = await $.clock.now()
  const shown = await current($)
  if (shown.file === path && shown.status === 'ready' && shown.diff !== '') {
    const rows = measure(shown).rows
    const landed = line === null ? null : nearestLine(rows, line)
    await patch($, { line: landed, isFlashing: landed !== null, isListOpen: false, change: -1 })
    await $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS })
    if (landed !== null) await flash($, mine, landed)

    return
  }
  await patch($, { file: path, line: null, diff: '', status: 'loading', message: '', isListOpen: false, isBasePickerOpen: false, expanded: [], change: -1 })
  await $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS })
  const before = await current($)
  const v = before.mergeBase === '' || !before.stats.some(stat => stat.path === path) ? await refresh($) : before
  if (v.status === 'error') return
  const loaded = await loadDiff($, v, path)
  if (mine !== opens) return
  if (loaded.isFailed) {
    await patch($, { status: 'error', message: loaded.err.split('\n')[0] || `git could not diff ${path}.` })

    return
  }
  const rows = parse(loaded.out)
  const isBinary = loaded.stat?.isBinary === true || (rows.length === 0 && isBinaryDiff(loaded.out))
  const landed = line === null || rows.length === 0 ? null : nearestLine(rows, line)
  const message = isBinary
    ? 'Binary file: there are no lines to show.'
    : rows.length === 0
      ? `No changes in this file against ${v.base}.`
      : landed !== null && landed !== line
        ? `Line ${line} is not in this file; showing line ${landed}.`
        : loaded.isTruncated
          ? 'This diff is very large; the end of it is cut off.'
          : ''
  await patch($, { diff: isBinary ? '' : loaded.out, isTruncated: loaded.isTruncated, status: 'ready', message, line: landed, isFlashing: landed !== null })
  record('open', (await $.clock.now()) - startedAt)
  if (landed !== null) await flash($, mine, landed)
  record('open+scroll', (await $.clock.now()) - startedAt)
}

const reload = async ($: EngineInterface) => {
  const v = await refresh($)
  if (v.file === null || v.status !== 'ready') return
  const loaded = await loadDiff($, v, v.file)
  if (!loaded.isFailed && loaded.out !== v.diff) await patch($, { diff: loaded.out, isTruncated: loaded.isTruncated })
}

const queueReload = async ($: EngineInterface) => {
  if (isRefreshQueued) return
  isRefreshQueued = true
  await $.clock.sleep(400)
  isRefreshQueued = false
  await reload($)
}

const showInFiles = async ($: EngineInterface, path: string, line: number | null) => {
  try {
    await $.mcp.call('ccd_view', 'show_pane', line === null ? { pane: 'file', path } : { pane: 'file', path, line })
  } catch {
    $.ui.toast(`${NAME}: could not open ${path}`)
  }
}

const tryNative = async ($: EngineInterface, path: string, line: number | null) => {
  const show = async (args: Record<string, unknown>) => {
    try {
      return (await $.mcp.call('ccd_view', 'show_pane', args)).isError ? 'error' : 'ok'
    } catch (error) {
      return String(error).slice(0, 60)
    }
  }
  const outcomes = [await show({ pane: 'diff', path })]
  for (const wait of [500, 900, 1500]) {
    await $.clock.sleep(wait)
    outcomes.push(await show(line === null ? { pane: 'diff', path } : { pane: 'diff', path, line }))
  }

  return outcomes.join(', ')
}

const follow = async ($: EngineInterface, path: string, line: number | null) => {
  const v = await current($)
  if (v.stats.some(stat => stat.path === path)) await openFile($, path, line)
  else await showInFiles($, path, line)
}

const stepFile = async ($: EngineInterface, by: number) => {
  const v = await current($)
  const at = v.stats.findIndex(stat => stat.path === v.file)
  const next = v.stats[at + by]
  if (next !== undefined) await openFile($, next.path, null)
}

const stepChange = async ($: EngineInterface, by: number) => {
  const v = await current($)
  const { drawn } = memo
  if (drawn.changes === 0) return
  const change = Math.max(0, Math.min(drawn.changes - 1, v.change + by))
  const run = drawn.parts.find((part): part is Run => 'rows' in part && part.change === change)
  await patch($, { change })
  await reveal($, run?.isTarget ? TARGET : `c${change}`)
}

const chooseBase = async ($: EngineInterface, base: string) => {
  await patch($, { isBasePickerOpen: false })
  const v = await refresh($, base)
  if (v.file !== null && v.base === base) await openFile($, v.file, null)
}

const basename = (path: string): string => path.split('/').slice(-1)[0] ?? path

export const register: Register = (on, options) => {
  settings.base = typeof options?.baseBranch === 'string' ? options.baseBranch.trim() : ''

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: NAME, description: 'Show changes against a base branch: /diff-lens [file[:line] | base <ref> | stats]' })
    void refresh($)

    return next(e)
  })

  on('command.run', { command: NAME }, async ($, e) => {
    const args = e.args.trim()
    if (args === 'stats') return { text: summarize() }
    if (args.startsWith('base')) {
      const ref = args.slice(4).trim()
      if (ref === '') return { text: `diff-lens compares against ${(await current($)).base || 'no base yet'}. Use /diff-lens base <ref> to change it.` }
      await chooseBase($, ref)
      const v = await current($)

      return { text: v.base === ref ? `diff-lens now compares against ${ref}.` : v.message }
    }
    if (args === 'native' || args.startsWith('native ')) {
      const shown = await current($)
      const wanted = args === 'native' ? { path: shown.file ?? '', line: shown.line } : splitLine(args.slice(7).trim())
      if (wanted.path === '') return { text: 'diff-lens: open a file in the pane first, or use /diff-lens native <file>:<line>.' }
      const outcome = await tryNative($, wanted.path, wanted.line)

      return { text: `diff-lens: asked the built-in Diff pane for ${wanted.path}${wanted.line === null ? '' : `:${wanted.line}`} four times (${outcome}).` }
    }
    const v = await refresh($)
    if (args === '') {
      await patch($, { isListOpen: true })
      await $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS })

      return { text: v.status === 'error' ? v.message : `diff-lens: ${v.stats.length} changed files against ${v.base}.` }
    }
    const target = splitLine(args)
    const path = toRelative(target.path, await $.session.cwd())
    if (path === null || !v.stats.some(stat => stat.path === path)) return { text: `diff-lens: ${target.path} has no changes against ${v.base}.` }
    void openFile($, path, target.line)

    return { text: `diff-lens: opened ${path}${target.line === null ? '' : ` at line ${target.line}`}.` }
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    void queueReload($)

    return ran
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    void queueReload($)

    return ran
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    void queueReload($)

    return ran
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'desktop' || !e.props.text.includes('](')) return next(e)
    const v = await current($)
    if (v.stats.length === 0) return next(e)
    const cwd = await $.session.cwd()
    const startedAt = Date.now()
    const changed = new Set(v.stats.map(stat => stat.path))
    const { text, hrefs, changed: hits } = rewrite(e.props.text, cwd, path => changed.has(path))
    record('rewrite links', Date.now() - startedAt)
    if (hits === 0 || hrefs.length > 256) return next(e)
    const { Markdown } = $.ui.resolve(e)

    return (
      <Markdown
        key="reply"
        text={text}
        pressableLinks={hrefs}
        onLinkPress={link => {
          const target = fromHref(link.href, cwd)
          if (target !== null) void follow($, target.path, target.line)
        }}
      />
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const v = await current($)
    const startedAt = Date.now()
    const { rows, drawn } = measure(v)
    const stat = v.stats.find(one => one.path === v.file)
    const tint = (kind: Row['kind']) => (kind === '+' ? 'diffAddedDimmed' : kind === '-' ? 'diffRemovedDimmed' : undefined)
    const ink = (kind: Row['kind']) => (kind === '+' ? 'diffAdded' : kind === '-' ? 'diffRemoved' : undefined)
    const width = String(rows.reduce((max, row) => Math.max(max, row.n), 0)).length + 2
    const columns = e.viewport?.columns ?? 80
    const at = v.stats.findIndex(one => one.path === v.file)
    const cite = (row: Row) => {
      if (v.file !== null) void $.prompt.fill({ text: `${v.file}:${row.n} `, mode: 'insert' })
    }
    const short = (text: string, room: number) => (text.length <= room ? text : `${text.slice(0, Math.max(1, room - 1))}…`)
    const counts = (one: FileStat) =>
      one.isUntracked ? (
        <Text color="diffAdded">new</Text>
      ) : one.isBinary ? (
        <Text dimColor>binary</Text>
      ) : (
        <Text>
          <Text color="diffAdded">+{one.added}</Text> <Text color="diffRemoved">-{one.removed}</Text>
        </Text>
      )

    const drawRun = (run: Run, index: number) => (
      <Box key={`run${index}`} flexDirection="column">
        {run.rows.map((row, i) => {
          const key = run.isTarget ? TARGET : run.change !== null && i === 0 ? `c${run.change}` : undefined

          return (
            <Box flexDirection="row" backgroundColor={run.isTarget && v.isFlashing ? 'suggestion' : tint(row.kind)}>
              <Box width={width} flexShrink={0} justifyContent="flex-end">
                <Button key={key} plain dimColor label={String(row.n)} onPress={() => cite(row)} />
              </Box>
              <Box width={3} flexShrink={0} justifyContent="center">
                <Text color={run.isTarget ? 'suggestion' : ink(row.kind)}>{run.isTarget ? '▸' : row.kind}</Text>
              </Box>
              <Text wrap="truncate-end">{row.text === '' ? ' ' : row.text}</Text>
            </Box>
          )
        })}
      </Box>
    )

    const drawFile = (one: FileStat, i: number) => {
      const isActive = one.path === v.file
      const folder = one.path.split('/').slice(0, -1).join('/')

      return (
        <Box key={`row${i}`} flexDirection="row" position="relative" backgroundColor={isActive ? 'diffAddedDimmed' : undefined} hover={{ backgroundColor: 'subtle' }}>
          <Box width={2} flexShrink={0}>
            <Text color="suggestion">{isActive ? '▌' : ' '}</Text>
          </Box>
          <Button key={`f${i}`} plain label={short(basename(one.path), Math.max(12, columns - 16))} onPress={() => void openFile($, one.path, null)} />
          <Box flexGrow={1} />
          <Box flexShrink={0} marginRight={1}>
            {counts(one)}
          </Box>
          {folder !== '' && (
            <Box position="absolute" top={1} left={2} display="none" hover={{ display: 'flex' }} backgroundColor="inverseText" borderStyle="round" borderDimColor paddingX={1}>
              <Text dimColor>{one.path}</Text>
            </Box>
          )}
        </Box>
      )
    }

    const tree = (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1} alignItems="center">
          <Button key="list" plain label={`${v.isListOpen ? '▾' : '▸'} ${v.stats.length} ${v.stats.length === 1 ? 'file' : 'files'}`} onPress={() => void patch($, { isListOpen: !v.isListOpen })} />
          {v.file !== null && (
            <Box flexGrow={1} flexShrink={1} flexDirection="row" gap={1}>
              <Text bold wrap="truncate-end">
                {short(basename(v.file), Math.max(12, columns - 34))}
              </Text>
              {stat !== undefined && <Box flexShrink={0}>{counts(stat)}</Box>}
            </Box>
          )}
          {v.file === null && <Box flexGrow={1} />}
          {v.stats.length > 1 && v.file !== null && (
            <Box flexShrink={0} flexDirection="row" gap={1}>
              <Text dimColor>
                {at + 1}/{v.stats.length}
              </Text>
              <Button key="prevFile" plain label="‹" onPress={() => void stepFile($, -1)} />
              <Button key="nextFile" plain label="›" onPress={() => void stepFile($, 1)} />
            </Box>
          )}
        </Box>
        <Box flexDirection="row" gap={1} alignItems="center">
          <Button key="base" plain dimColor label={`${v.base || 'no base'} → working tree`} onPress={() => void patch($, { isBasePickerOpen: !v.isBasePickerOpen })} />
          <Box flexGrow={1} />
          {drawn.changes > 0 && (
            <Box flexShrink={0} flexDirection="row" gap={1}>
              <Text dimColor>{v.change >= 0 ? `change ${v.change + 1}/${drawn.changes}` : `${drawn.changes} ${drawn.changes === 1 ? 'change' : 'changes'}`}</Text>
              <Button key="prevChange" plain label="↑" onPress={() => void stepChange($, -1)} />
              <Button key="nextChange" plain label="↓" onPress={() => void stepChange($, 1)} />
            </Box>
          )}
        </Box>
        {v.isBasePickerOpen && (
          <Box flexDirection="row" flexWrap="wrap" gap={1} marginTop={1}>
            <Text dimColor>Compare against</Text>
            {v.bases.map((base, i) => (
              <Button key={`base${i}`} label={base} variant={base === v.base ? 'primary' : 'secondary'} onPress={() => void chooseBase($, base)} />
            ))}
          </Box>
        )}
        {v.message !== '' && (
          <Text color={v.status === 'error' ? 'error' : 'warning'} wrap="wrap">
            {v.message}
          </Text>
        )}
        {v.status === 'loading' && <Text dimColor>Loading…</Text>}
        {v.status !== 'error' && v.stats.length === 0 && <Text dimColor>No changes against {v.base || 'the base branch'}.</Text>}
        {v.status === 'idle' && v.stats.length > 0 && v.file === null && <Text dimColor>Click a file link in a reply, or pick a file below.</Text>}
        {v.isListOpen && (
          <Box flexDirection="column" marginTop={1}>
            {v.stats.map(drawFile)}
          </Box>
        )}
        <Box flexDirection="column" marginTop={1}>
          {drawn.parts.map((part, index) =>
            'fold' in part ? (
              <Box flexDirection="row">
                <Box width={width} flexShrink={0} />
                <Button
                  key={`fold${part.fold}`}
                  plain
                  dimColor
                  label={`▸ ${part.count} unmodified ${part.count === 1 ? 'line' : 'lines'}`}
                  onPress={() => void patch($, { expanded: [...v.expanded, part.fold] })}
                />
              </Box>
            ) : (
              drawRun(part, index)
            ),
          )}
          {drawn.hidden > 0 && <Text dimColor>{drawn.hidden} more lines are not shown; open the file to see them all.</Text>}
        </Box>
      </Box>
    )
    record('render pane', Date.now() - startedAt)

    return tree
  })
}
