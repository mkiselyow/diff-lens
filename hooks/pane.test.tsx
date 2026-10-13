import { describe, expect, mock, test } from 'claude-code/testing'

const DIFF = ['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1,3 +1,3 @@', ' one', '-two', '+TWO', ' three'].join('\n')
const PANE = { plugin: 'diff-lens', component: 'Pane', requestId: 'diff-lens', props: { title: 'Diff lens', isFocused: false, bodyColumns: 60, placement: 'dock' } } as const

const calls: string[] = []

const answer = (argv: readonly string[], isRepo: boolean) => {
  calls.push(argv.slice(4).join(' '))
  const args = argv.slice(4)
  const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '' })
  const fail = { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository' }
  if (!isRepo) return fail
  if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') return ok('true\n')
  if (args[0] === 'rev-parse' && args[1] === '--verify') return args[3] === 'origin/main^{commit}' ? ok('abc\n') : fail
  if (args[0] === 'symbolic-ref') return ok('origin/main\n')
  if (args[0] === 'rev-parse') return fail
  if (args[0] === 'merge-base') return ok('abc123\n')
  if (args[0] === 'diff' && args[1] === '--numstat') return ok('1\t1\tsrc/a.ts\u0000-\t-\tlogo.png\u0000')
  if (args[0] === 'ls-files') return ok('')
  if (args[0] === 'diff' && args[args.length - 1] === 'src/a.ts') return ok(DIFF)
  if (args[0] === 'diff') return ok('Binary files a/logo.png and b/logo.png differ\n')

  return fail
}

describe('pane', () => {
  for (const surface of ['desktop', 'terminal'] as const) {
    test(`lists changed files and shows one with its changes on ${surface}`, async ($, on) => {
      mock.clock(on)
      on('session.cwd', async () => ({ value: '/repo' }))
      on('process.run', async (_, e) => ({ value: answer(e.argv, true) }) as never)
      on('ui.open', async () => ({ value: {} }) as never)
      on('ui.scroll', async () => ({ value: {} }) as never)

      await $.command.run({ command: 'diff-lens', args: '' } as never)
      const ui = await $.ui.mount({ ...PANE, surface } as never)

      expect(await ui.find({ text: /2 files/ })).toBeDefined()
      expect(await ui.find({ text: /a\.ts/ })).toBeDefined()

      await ui.press({ key: 'f0' })

      expect(await ui.find({ type: 'Text', text: 'TWO' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'two' })).toBeDefined()
      expect(await ui.find({ text: /1 change/ })).toBeDefined()

      expect(await ui.find({ key: 'f1' })).toBeUndefined()
      await ui.press({ key: 'list' })
      await ui.press({ key: 'f1' })

      expect(await ui.find({ text: /Binary file/ })).toBeDefined()
      await ui.unmount()
    })
  }

  test('loads the open file again when the base is chosen', async ($, on) => {
    mock.clock(on)
    on('session.cwd', async () => ({ value: '/repo' }))
    on('process.run', async (_, e) => ({ value: answer(e.argv, true) }) as never)
    on('ui.open', async () => ({ value: {} }) as never)
    on('ui.scroll', async () => ({ value: {} }) as never)
    const diffs = () => calls.filter(call => call.startsWith('diff --no-renames') && call.endsWith('src/a.ts')).length

    await $.command.run({ command: 'diff-lens', args: '' } as never)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' } as never)
    await ui.press({ key: 'f0' })
    const before = diffs()
    await ui.press({ key: 'base' })
    await ui.press({ key: 'base0' })

    expect(diffs()).toBe(before + 1)
    expect(await ui.find({ type: 'Text', text: 'TWO' })).toBeDefined()
    await ui.unmount()
  })

  test('lets the model set the base and refuses one that does not exist', async ($, on) => {
    mock.clock(on)
    on('session.cwd', async () => ({ value: '/repo' }))
    on('process.run', async (_, e) => ({ value: answer(e.argv, true) }) as never)
    on('ui.open', async () => ({ value: {} }) as never)

    const set = await $.tool.call({ tool: 'mcp__diff-lens__compare', base: 'origin/main' } as never)
    const missing = await $.tool.call({ tool: 'mcp__diff-lens__compare', base: 'nope' } as never)

    const detected = await $.tool.call({ tool: 'mcp__diff-lens__compare' } as never)

    expect(String(detected.result)).toContain('origin/main (the detected default): 2 changed files')
    expect(String(set.result)).toContain('origin/main: 2 changed files')
    expect(missing.deny ?? missing.text ?? '').toContain('nope')
  })

  test('says so when the folder is not a git repository', async ($, on) => {
    mock.clock(on)
    on('session.cwd', async () => ({ value: '/tmp' }))
    on('process.run', async (_, e) => ({ value: answer(e.argv, false) }) as never)
    on('ui.open', async () => ({ value: {} }) as never)

    await $.command.run({ command: 'diff-lens', args: '' } as never)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' } as never)

    expect(await ui.find({ text: /not a git repository/ })).toBeDefined()
    await ui.unmount()
  })
})
