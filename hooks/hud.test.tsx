import { expect, mock, test } from 'claude-code/testing'

const HINT = {
  component: 'PromptHint',
  props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
} as const

const PANE = {
  component: 'Pane',
  requestId: 'reeve',
  props: {
    title: 'Reeve',
    isFocused: false,
    bodyColumns: 70,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

const ok = (stdout: string) => ({
  value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

test('line shows folder and PR links, details opens in side panel', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-18T10:00:00Z') })
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: {
        window: 200_000,
        tokens: 36_000,
        percent: 18,
        breakdown: {
          categories: [],
          mcpTools: [],
          skills: {
            totalSkills: 31,
            includedSkills: 31,
            tokens: 31,
            skillFrontmatter: [
              ...Array.from({ length: 20 }, (_, i) => ({ name: `alpha-${String(i).padStart(2, '0')}`, source: 'plugin', tokens: 1 })),
              ...Array.from({ length: 11 }, (_, i) => ({ name: `beta-${String(i).padStart(2, '0')}`, source: 'plugin', tokens: 1 })),
            ],
          },
        } as never,
      },
      rateLimits: [{ kind: 'five_hour', percentUsed: 23, resetsAt: '2026-10-18T12:14:00Z' }],
      cost: { usd: 0.87 },
    },
  }))
  on('command.list', () => ({ value: [] }))
  on('settings.read', () => ({ value: {} }))
  on('session.cwd', () => ({ value: 'C:/code/play/claudmods' }))
  on('ui.toast', () => ({ value: undefined }))
  const files = new Map<string, string>()
  on('fs.exists', (_$, e) => ({ value: files.has(e.path) }))
  on('fs.read', (_$, e) => ({ value: files.get(e.path) ?? '' }))
  on('fs.write', (_$, e) => (files.set(e.path, e.text), { value: undefined }))
  const panes: string[] = []
  on('ui.open', (_$, e) => (panes.push(`open ${e.id}`), { value: { isPlaced: true } }))
  on('ui.close', (_$, e) => (panes.push(`close ${e.id}`), { value: undefined }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  const opened: string[][] = []
  on('process.run', (_$, e) => {
    if (e.argv[0] === 'powershell.exe') opened.push([...e.argv])
    if (e.argv[0] === 'gh') return ok('{"number":42,"url":"https://github.com/o/r/pull/42"}')
    if (e.argv.includes('status')) return ok('# branch.head main\n# branch.ab +0 -0\n')
    return ok('')
  })
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.hint}</Text>
  })

  const hint = await $.ui.mount({ plugin: 'reeve', surface: 'terminal', ...HINT })
  expect(await hint.find({ type: 'Text', text: /🤖/ })).toBeDefined()
  expect(await hint.find({ type: 'Text', text: /for shortcuts/ })).toBeUndefined()
  expect((await hint.find({ type: 'Text', text: / · serfs \(0\)/ }))?.props.color).toBe('#585858')

  await hint.press({ key: 'folder' })
  expect(opened[0]?.[0]).toBe('powershell.exe')
  expect(opened[0]?.[4]).toContain(String.raw`'"C:\code\play\claudmods"'`)
  expect([...files.values()].join('')).toContain('folder ["powershell.exe"')

  const band = await $.ui.mount({ plugin: 'reeve', surface: 'terminal', ...PANE })
  await hint.press({ key: 'toggle' })
  expect(await band.find({ type: 'Text', text: /SESSION/ })).toBeDefined()

  expect(await band.find({ type: 'Text', text: /0 running · 0 total/ })).toBeDefined()

  expect(await band.find({ type: 'Text', text: /hooks \(0\) · mcp \(0\) · mods \(1\) · skills \(31\)/ })).toBeDefined()

  await band.press({ key: 'loaded' })
  expect(await band.find({ type: 'Text', text: /▴ less/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /^beta-00, beta-01/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /alpha-19, beta/ })).toBeUndefined()

  await band.press({ key: 'close' })
  expect((await hint.find({ key: 'toggle' }))?.text).toBe('▸ details')
  expect(panes).toEqual(['open reeve', 'close reeve'])

  await hint.unmount()
  await band.unmount()
})

test('narrow line drops emoji and labels, hides weekly under 90%, keeps PR, toggle is +', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-18T10:00:00Z') })
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200_000, tokens: 36_000, percent: 18 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 23, resetsAt: '2026-10-18T12:14:00Z' },
        { kind: 'seven_day', percentUsed: 50, resetsAt: '2026-10-20T10:00:00Z' },
      ],
    } as never,
  }))
  on('command.list', () => ({ value: [] }))
  on('settings.read', () => ({ value: {} }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.cwd', () => ({ value: 'C:/code/play/claudmods' }))
  on('env.get', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('command.register', () => ({ value: {} }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('process.run', (_$, e) => {
    if (e.argv[0] === 'gh') return ok('{"number":42,"url":"https://github.com/o/r/pull/42"}')
    if (e.argv.includes('status')) return ok('# branch.head main\n# branch.ab +0 -0\n')
    return ok('')
  })

  await $.session.start({ cwd: 'C:/code/play/claudmods', surface: 'terminal', isInteractive: true })
  const hint = await $.ui.mount({ plugin: 'reeve', surface: 'terminal', ...HINT, viewport: { columns: 100, rows: 40 } })
  expect(await hint.find({ type: 'Text', text: /^ Opus 5\.5$/ })).toBeDefined()
  expect(await hint.find({ type: 'Text', text: /^ 0$/ })).toBeDefined()
  expect(await hint.find({ type: 'Text', text: /^18%$/ })).toBeDefined()
  expect(await hint.find({ type: 'Text', text: /^23% \(2h14m\)$/ })).toBeDefined()
  expect(await hint.find({ type: 'Text', text: /50%/ })).toBeUndefined()
  expect(await hint.find({ type: 'Text', text: /^📁$/ })).toBeDefined()
  expect(await hint.find({ type: 'Text', text: /^main$/ })).toBeDefined()
  expect(await hint.find({ type: 'Text', text: /^\(PR#42\)$/ })).toBeDefined()
  expect((await hint.find({ key: 'toggle' }))?.text).toBe('+')

  await hint.unmount()
})

test('back button shows only while viewing an agent and returns to main', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-18T10:00:00Z') })
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } as never }))
  on('command.list', () => ({ value: [] }))
  on('settings.read', () => ({ value: {} }))
  on('process.run', () => ok(''))
  const views: unknown[] = []
  on('ui.view', (_$, e) => (views.push({ ...e }), { value: {} }))

  const main = await $.ui.mount({ plugin: 'reeve', surface: 'terminal', ...PANE })
  expect(await main.find({ key: 'back' })).toBeUndefined()
  await main.unmount()

  const agent = await $.ui.mount({
    plugin: 'reeve',
    surface: 'terminal',
    ...PANE,
    props: { ...PANE.props, view: { agentId: 'a1' } },
  })
  await agent.press({ key: 'back' })
  expect(views).toEqual([{}])
  await agent.unmount()
})
