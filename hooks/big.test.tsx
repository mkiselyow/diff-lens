import { expect, mock, test } from 'claude-code/testing'

import { REAL } from './real.fixture'

const PANE = { plugin: 'diff-lens', component: 'Pane', requestId: 'diff-lens', props: { title: 'Diff lens', isFocused: false, bodyColumns: 60, placement: 'dock' } } as const
const lines = (n: number) => Array.from({ length: n }, (_, i) => `+const value${i} = compute(${i}) // a fairly ordinary line of source code`).join('\n')

for (const size of [0, 500]) {
  test(`keeps the drawing small for ${size === 0 ? 'a real large diff' : `${size} changed lines`}`, async ($, on) => {
    mock.clock(on)
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } })
    on('session.cwd', async () => ({ value: '/repo' }))
    on('ui.open', async () => ({ value: {} }) as never)
    on('ui.scroll', async () => ({ value: {} }) as never)
    on('process.run', async (_, e) => {
      const args = e.argv.slice(4)
      if (args[0] === 'diff' && args[1] === '--numstat') return ok(`${size}\t0\tbig.ts\u0000`) as never
      if (args[0] === 'diff') return ok(size === 0 ? REAL : `@@ -0,0 +1,${size} @@\n${lines(size)}`) as never
      if (args[0] === 'ls-files') return ok('') as never
      if (args[0] === 'rev-parse' && args[1] === '--verify' && args[3] !== 'origin/main^{commit}') return { value: { exitCode: 1, stdout: '', stderr: '' } } as never

      return ok('origin/main\n') as never
    })

    await $.command.run({ command: 'diff-lens', args: '' } as never)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' } as never)
    await ui.press({ key: 'f0' })

    const drawn = JSON.stringify(await ui.drawn())

    expect(drawn.length).toBeLessThan(90000)
    expect(await ui.find({ key: 'later' })).toBeDefined()
    await ui.unmount()
  })
}
