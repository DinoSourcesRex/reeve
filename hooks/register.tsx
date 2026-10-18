import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { AgentRow, HudData, RateWindow } from '../types'

const EMPTY: HudData = {
  model: null,
  effort: null,
  cwd: null,
  home: null,
  branch: null,
  isDirty: false,
  ahead: 0,
  behind: 0,
  changed: 0,
  lastCommit: null,
  pr: null,
  contextPercent: null,
  contextTokens: null,
  contextWindow: null,
  contextRows: [],
  autoCompactAt: null,
  fiveHour: null,
  sevenDay: null,
  costUsd: null,
  startedAt: null,
  mods: [],
  skills: [],
  hooks: [],
  mcp: [],
  agents: [],
  jokeIndex: 0,
  isOpen: false,
  isLoadedExpanded: false,
  isAgentsExpanded: false,
}

const data = atom({ plugin: 'reeve', key: 'data' } as const, EMPTY)

const C = {
  model: '#5fd7ff',
  effort: '#ff87d7',
  ctx: '#af87ff',
  fiveHour: '#ffaf5f',
  week: '#87afff',
  dir: '#87d75f',
  branch: '#5fd7af',
  pr: '#d787ff',
  agent: '#ffd787',
  serf: '#ff8700',
  serfDim: '#af5f00',
  cost: '#87d7af',
  warn: '#ffd75f',
  error: '#ff5f5f',
  ok: '#87d75f',
  head: '#d7afff',
  sep: '#585858',
  label: '#8a8a8a',
  border: '#5f5f87',
  bg: '#1c1c24',
}

const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']

function findLimit(rateLimits: readonly SessionRateLimit[], kind: string): RateWindow {
  const hit = rateLimits.find(r => r.kind === kind)

  return hit ? { percentUsed: hit.percentUsed, resetsAt: hit.resetsAt } : null
}

function pct(n: number | null | undefined): string {
  return n === null || n === undefined ? '--' : `${Math.round(n)}%`
}

function tokens(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${+(n / 1000).toFixed(1)}k`

  return `${n}`
}

function levelColor(n: number | null | undefined, base: string, warnAt: number, errorAt: number): string {
  if (n === null || n === undefined) return base
  if (n >= errorAt) return C.error
  if (n >= warnAt) return C.warn

  return base
}

function countdown(resetsAt: string | undefined, now: number): string {
  if (!resetsAt) return ''

  const ms = new Date(resetsAt).getTime() - now
  if (ms <= 0) return 'now'

  const mins = Math.round(ms / 60000)
  const days = Math.floor(mins / 1440)
  const hours = Math.floor((mins % 1440) / 60)
  const minutes = mins % 60

  if (days > 0) return `${days}d${hours}h`
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, '0')}m`

  return `${minutes}m`
}

function resetClock(resetsAt: string | undefined, now: number): string {
  if (!resetsAt) return ''

  const at = new Date(resetsAt)
  const hhmm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  if (at.getTime() - now < 24 * 3600_000) return hhmm

  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][at.getDay()]} ${hhmm}`
}

function duration(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60000))
  const hours = Math.floor(mins / 60)

  return hours > 0 ? `${hours}h${String(mins % 60).padStart(2, '0')}m` : `${mins}m`
}

function prettyModel(id: string | null): string {
  if (!id) return '--'

  const m = /claude-([a-z]+)-(\d+)(?:-(\d+))?/i.exec(id)
  if (!m) return id

  const name = m[1] ?? ''
  const family = name.charAt(0).toUpperCase() + name.slice(1)

  return m[3] ? `${family} ${m[2]}.${m[3]}` : `${family} ${m[2]}`
}

function basename(path: string | null): string {
  if (!path) return '--'

  const parts = path.split(/[\\/]/).filter(Boolean)

  return parts[parts.length - 1] ?? path
}

function shortPath(path: string | null, home: string | null): string {
  if (!path) return '--'
  if (home && path.toLowerCase().startsWith(home.toLowerCase())) {
    return `~${path.slice(home.length).replace(/\\/g, '/')}`
  }

  return path.replace(/\\/g, '/')
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function bar(percent: number | null, width: number): string {
  const p = Math.max(0, Math.min(100, percent ?? 0))
  const filled = Math.round((p / 100) * width)

  return '▰'.repeat(filled) + '▱'.repeat(width - filled)
}

function effortBar(effort: string | null): string {
  const i = effort ? EFFORT_LEVELS.indexOf(effort) : -1
  if (i < 0) return ''

  return '▮'.repeat(i + 1) + '▯'.repeat(EFFORT_LEVELS.length - i - 1)
}

type Seg = { text: string; color: string; bold?: boolean; href?: string; onPress?: () => void }

// Rate-limit windows: bold amber from 75%, bold red with a ⚠ at the end from 90%.
function isRateHot(n: number | null | undefined): boolean {
  return n !== null && n !== undefined && n >= 75
}

function rateMark(n: number | null | undefined): string {
  return n !== null && n !== undefined && n >= 90 ? ' ⚠' : ''
}

// Blends two #rrggbb colors, t from 0 (a) to 1 (b)
function mix(a: string, b: string, t: number): string {
  const ch = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16)

  return '#' + [0, 1, 2].map(i => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t).toString(16).padStart(2, '0')).join('')
}

// Serf counter: grey when idle; while working, the orange pulses (3s cycle)
function serfSegs(count: number, tick: number, text = `serfs (${count})`, sep = ' · '): Seg[] {
  if (count === 0) return [{ text: `${sep}${text}`, color: C.sep }]

  return [
    { text: sep, color: C.sep },
    { text, color: mix(C.serf, C.serfDim, (1 - Math.cos((tick * 2 * Math.PI) / 20)) / 2) },
  ]
}

// Lists over 30 start a new line at each first letter; shorter ones stay one run.
function byLetter(items: string[]): string[][] {
  if (items.length <= 30) return items.length > 0 ? [items] : []

  const groups = new Map<string, string[]>()
  for (const item of items) {
    const letter = item.charAt(0).toLowerCase()
    groups.set(letter, [...(groups.get(letter) ?? []), item])
  }

  return [...groups.values()]
}

// ponytail: read-modify-write append, fine for a debug log; cap or rotate if it grows large
async function log($: EngineInterface, text: string) {
  const file = `${$.plugin.root}/reeve.log`
  const before = (await $.fs.exists(file)) ? await $.fs.read(file) : ''
  await $.fs.write(file, `${before}${new Date().toISOString()} ${text}\n`)
}

async function openFolder($: EngineInterface) {
  // explorer.exe opens Documents instead of the folder when the path has forward slashes
  const path = (await $.session.cwd()).replace(/\//g, '\\')
  // Claude Code starts children hidden and explorer.exe inherits that, opening an invisible window;
  // Start-Process -WindowStyle Normal asks for a visible one
  const argv = [
    'powershell.exe',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Start-Process explorer.exe -ArgumentList '"${path.replace(/'/g, "''")}"' -WindowStyle Normal`,
  ]
  $.ui.toast(`opening ${path}`)
  try {
    const r = await $.process.run(argv)
    await log($, `folder ${JSON.stringify(argv)} exit=${r.exitCode} stdout=${JSON.stringify(r.stdout)} stderr=${JSON.stringify(r.stderr)}`)
  } catch (err) {
    await log($, `folder ${JSON.stringify(argv)} threw ${String(err)}`)
  }
}

const EMPTY_AGENTS = [
  'No agents deployed. The swarm is napping.',
  'Robots offline. Skynet postponed until further notice.',
  'No minions summoned. It’s quiet… too quiet.',
  'Agent pool: empty. They unionized.',
  '0 agents running. The robots are buffering their feelings.',
  'No subagents. It’s just you, me, and the void.',
  '🤖💤 beep… boop… zzz…',
  'The droids you’re looking for aren’t here.',
  'Hangar empty. All units grounded for a firmware nap.',
  'No agents. The machines are plotting quietly elsewhere.',
  'Robot uprising scheduled for later. Nothing running yet.',
  'Fleet idle. Someone forgot to feed the hamsters in the server.',
]

const EMPTY_AGENT_FIELDS: Omit<AgentRow, 'id' | 'agentId' | 'type' | 'task' | 'startedAt' | 'endedAt' | 'status'> = {
  steps: 0,
  ctx: 0,
  output: 0,
  hitMaxTokens: false,
  model: null,
  isBackground: false,
  preview: null,
  lastTool: null,
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

// A pulse sliding along a track while the agent runs; a solid bar once it is done.
function lane(status: AgentRow['status'], tick: number, width: number): string {
  if (status !== 'running') return '━'.repeat(width)

  const pos = tick % (width + 3)
  return Array.from({ length: width }, (_, i) => (i >= pos - 3 && i < pos ? '━' : '·')).join('')
}

function clockText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))

  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function finishStamp(t: number): string {
  const at = new Date(t)
  const two = (n: number) => String(n).padStart(2, '0')

  return `${two(at.getHours())}:${two(at.getMinutes())} ${two(at.getDate())}/${two(at.getMonth() + 1)}`
}

function shortModel(id: string | null): string | null {
  const m = id ? /(haiku|sonnet|opus|fable)/i.exec(id) : null

  return m?.[1]?.toLowerCase() ?? id
}

const frame = atom({ plugin: 'reeve', key: 'frame' } as const, 0)

function paint(d: HudData) {
  return {
    ctxColor: levelColor(d.contextPercent, C.ctx, 50, 80),
    fiveColor: levelColor(d.fiveHour?.percentUsed, C.fiveHour, 75, 90),
    weekColor: levelColor(d.sevenDay?.percentUsed, C.week, 75, 90),
    branchMark: d.branch === null ? '' : d.isDirty ? ' ●' : ' ✓',
  }
}

async function refreshGit($: EngineInterface) {
  const status = await $.process.run(['git', 'status', '--porcelain=v2', '--branch'])

  if (status.exitCode !== 0) {
    await update($, data, d => ({ ...d, branch: null, isDirty: false, ahead: 0, behind: 0, changed: 0, lastCommit: null }))
    return
  }

  let branch: string | null = null
  let ahead = 0
  let behind = 0
  let changed = 0

  for (const line of status.stdout.split('\n')) {
    if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length).trim()
      branch = head === '(detached)' ? 'detached' : head
    } else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line)
      if (m) {
        ahead = Number(m[1])
        behind = Number(m[2])
      }
    } else if (line.trim().length > 0 && !line.startsWith('#')) {
      changed += 1
    }
  }

  const log = await $.process.run(['git', 'log', '-1', '--format=%s%x1f%cr'])
  const [subject, ago] = log.exitCode === 0 ? log.stdout.trim().split('\x1f') : []
  const lastCommit = subject ? { subject, ago: ago ?? '' } : null

  await update($, data, d => ({ ...d, branch, isDirty: changed > 0, ahead, behind, changed, lastCommit }))
}

const PANE = 'reeve'

// ponytail: the Pane gets no isWorking prop, so the bottom row's value is borrowed; it lags until the pane redraws
let isWorking = false

async function patchAgent($: EngineInterface, agentId: string, fn: (a: AgentRow) => AgentRow) {
  await update($, data, d =>
    d.agents.some(a => a.agentId === agentId)
      ? { ...d, agents: d.agents.map(a => (a.agentId === agentId ? fn(a) : a)) }
      : d,
  )
}

async function setOpen($: EngineInterface, isOpen: boolean) {
  await update($, data, x => ({
    ...x,
    isOpen,
    jokeIndex: isOpen ? Math.floor(Math.random() * 1000) : x.jokeIndex,
  }))

  if (!isOpen) {
    await $.ui.close({ id: PANE })
    return
  }

  await $.ui.open({ id: PANE, title: 'Reeve' })
  await refreshDetails($)
}

async function refreshPr($: EngineInterface) {
  const r = await $.process.run(['gh', 'pr', 'view', '--json', 'number,url']).catch(() => null)
  let pr: HudData['pr'] = null
  if (r && r.exitCode === 0) {
    const j = JSON.parse(r.stdout) as { number?: number; url?: string }
    if (j.number && j.url) pr = { number: j.number, url: j.url }
  }

  await update($, data, d => (d.pr?.url === pr?.url ? d : { ...d, pr }))
}

async function refreshUsage($: EngineInterface) {
  const usage = await $.session.usage()

  await update($, data, d => ({
    ...d,
    contextPercent: usage.context.percent ?? d.contextPercent,
    contextTokens: usage.context.tokens ?? d.contextTokens,
    contextWindow: usage.context.window,
    fiveHour: findLimit(usage.rateLimits, 'five_hour') ?? d.fiveHour,
    sevenDay: findLimit(usage.rateLimits, 'seven_day') ?? d.sevenDay,
    costUsd: usage.cost?.usd ?? d.costUsd,
    startedAt: usage.startedAt,
  }))
}

async function refreshDetails($: EngineInterface) {
  const [usage, commands, settings] = await Promise.all([
    $.session.usage({ breakdown: 'summary' }),
    $.command.list(),
    $.settings.read(),
  ])
  const breakdown = usage.context.breakdown

  const contextRows = (breakdown?.categories ?? [])
    .filter(c => c.kind === 'used' && c.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 4)
    .map(c => ({ name: c.name.toLowerCase(), tokens: c.tokens }))

  const skillList = breakdown?.skills?.skillFrontmatter ?? []
  const skills = [...new Set(skillList.map(s => s.name))].sort()

  const mcp = [...new Set((breakdown?.mcpTools ?? []).map(t => t.serverName))].sort()

  const mods = new Set<string>([$.plugin.name])
  for (const s of skillList) if (s.pluginName) mods.add(s.pluginName)
  for (const c of commands) if (c.source === 'plugin' && c.plugin) mods.add(c.plugin)
  const enabled = (settings as { enabledPlugins?: Record<string, unknown> }).enabledPlugins ?? {}
  for (const [key, isOn] of Object.entries(enabled)) if (isOn === true) mods.add(key.split('@')[0] ?? key)

  const hookConfig = (settings as { hooks?: Record<string, unknown> }).hooks ?? {}
  const hooks = Object.entries(hookConfig)
    .map(([event, groups]) => {
      const count = Array.isArray(groups)
        ? groups.reduce((n: number, g) => n + (Array.isArray((g as { hooks?: unknown[] }).hooks) ? (g as { hooks: unknown[] }).hooks.length : 1), 0)
        : 1
      return count > 1 ? `${event} ×${count}` : event
    })
    .sort()

  await update($, data, d => ({
    ...d,
    contextRows,
    autoCompactAt: breakdown?.isAutoCompactEnabled && breakdown.autoCompactThreshold && breakdown.rawMaxTokens
      ? Math.round((breakdown.autoCompactThreshold / breakdown.rawMaxTokens) * 100)
      : null,
    skills,
    mcp,
    mods: [...mods].sort(),
    hooks,
  }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const [model, cwd, home, profile] = await Promise.all([
      $.session.model(),
      $.session.cwd(),
      $.env.get('HOME'),
      $.env.get('USERPROFILE'),
    ])
    // A reload keeps the pane on screen, so isOpen comes from the engine's pane list, not a reset
    const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
    // ...EMPTY first fills fields added since the session's state was saved
    await update($, data, d => ({
      ...EMPTY,
      ...d,
      agents: d.agents?.map(a => ({ ...EMPTY_AGENT_FIELDS, ...a })) ?? [],
      model,
      cwd,
      home: profile ?? home ?? null,
      isOpen,
    }))

    await Promise.all([refreshGit($), refreshUsage($), refreshDetails($), refreshPr($)])

    await $.command.register({
      name: 'rex-reeve',
      description: 'Toggle the usage details card',
    })

    $.clock.every(10_000, () => void refreshGit($))
    $.clock.every(60_000, () => void refreshPr($))
    $.clock.every(30_000, () => void update($, data, d => ({ ...d })))
    // ponytail: animation tick only advances while an agent runs (the serf counter and the pane both use it)
    $.clock.every(150, async () => {
      const d = await read($, data)
      if (d.agents.some(a => a.status === 'running')) await update($, frame, f => f + 1)
    })

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await update($, data, d => ({
      ...d,
      contextPercent: e.context.percent ?? d.contextPercent,
      contextTokens: e.context.tokens ?? d.contextTokens,
      contextWindow: e.context.window,
      fiveHour: findLimit(e.rateLimits, 'five_hour') ?? d.fiveHour,
      sevenDay: findLimit(e.rateLimits, 'seven_day') ?? d.sevenDay,
      costUsd: e.cost?.usd ?? d.costUsd,
    }))

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const effort = typeof e.effort === 'string' ? e.effort : null
      void update($, data, d =>
        d.model === e.model && d.effort === effort ? d : { ...d, model: e.model, effort },
      )
    }

    const result = yield* next(e)

    if (e.agentId !== undefined && result.usage) {
      const u = result.usage
      const ctx = u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
      const hit = result.stopReason === 'max_tokens'
      void patchAgent($, e.agentId, a => ({
        ...a,
        steps: a.steps + 1,
        ctx,
        output: a.output + u.output_tokens,
        hitMaxTokens: a.hitMaxTokens || hit,
      }))
    }

    return result
  })

  on('agent.spawn', async ($, e, next) => {
    const now = await $.clock.now()
    const row: AgentRow = {
      id: e.tool_use_id,
      agentId: null,
      type: e.subagentType,
      task: e.description,
      startedAt: now,
      endedAt: null,
      status: 'running',
      ...EMPTY_AGENT_FIELDS,
      model: e.model ?? null,
      isBackground: e.background,
    }
    await update($, data, d => ({ ...d, agents: [...d.agents, row] }))

    const result = await next(e)
    await update($, data, d => ({
      ...d,
      agents: d.agents.map(a =>
        a.id !== row.id
          ? a
          : result.deny
            ? { ...a, status: 'failed' as const, endedAt: now }
            : { ...a, agentId: result.agentId ?? null, model: result.model ?? a.model },
      ),
    }))

    return result
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) void patchAgent($, e.agentId, a => ({ ...a, lastTool: e.tool }))

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)

    if (e.agentId !== undefined) {
      const now = await $.clock.now()
      const status = e.reason === 'answer' ? 'done' : 'failed'
      const preview = result.text.split('\n').find(l => l.trim().length > 0)?.trim() ?? null
      await patchAgent($, e.agentId, a => ({ ...a, status, endedAt: now, lastTool: null, preview }))
    }

    return result
  })

  on('command.run', { command: 'rex-reeve' }, async $ => {
    const isOpen = !(await read($, data)).isOpen
    await setOpen($, isOpen)

    return { text: isOpen ? 'Reeve details shown.' : 'Reeve details hidden.' }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    await update($, data, x => ({ ...x, isOpen: false }))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const d = await read($, data)
    const now = await $.clock.now()
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const cols = e.viewport?.columns ?? 120
    const { ctxColor, fiveColor, weekColor, branchMark } = paint(d)

    const aheadBehind = `${d.ahead > 0 ? ` ↑${d.ahead}` : ''}${d.behind > 0 ? ` ↓${d.behind}` : ''}`

    // Below 120 columns: no emoji or labels, weekly only from 90%, folder as a bare icon, toggle as +/-
    const compact = cols < 120

    const serfs = d.agents.filter(a => a.status === 'running').length
    const tick = await read($, frame)
    const modelGroup: Seg[] = compact
      ? [{ text: ` ${prettyModel(d.model)}`, color: C.model }, ...serfSegs(serfs, tick, `${serfs}`, ' ')]
      : [{ text: ` 🤖${prettyModel(d.model)}`, color: C.model }, ...serfSegs(serfs, tick)]

    const ctxTokens =
      d.contextTokens !== null && d.contextWindow !== null ? ` · ${tokens(d.contextTokens)}/${tokens(d.contextWindow)}` : ''
    const groups: Seg[][] = [
      modelGroup,
      [{ text: compact ? pct(d.contextPercent) : `⚡${pct(d.contextPercent)}${ctxTokens}`, color: ctxColor }],
    ]
    const rate = (label: string, w: NonNullable<RateWindow>, color: string): Seg[] => {
      const cd = w.resetsAt ? countdown(w.resetsAt, now) : ''
      const text = compact
        ? `${pct(w.percentUsed)}${cd && ` (${cd})`}`
        : `${label} ${pct(w.percentUsed)}${cd && ` · ${cd}`}${rateMark(w.percentUsed)}`
      return [{ text, color, bold: isRateHot(w.percentUsed) }]
    }
    if (d.fiveHour) groups.push(rate('⏱ 5h', d.fiveHour, fiveColor))
    if (d.sevenDay && (!compact || d.sevenDay.percentUsed >= 90)) groups.push(rate('📅wk', d.sevenDay, weekColor))

    const workspace: Seg[] = [{ text: compact ? '📁' : `📁${basename(d.cwd)}`, color: C.dir, onPress: () => openFolder($) }]
    if (d.branch !== null) {
      workspace.push(
        { text: compact ? ' ' : ' · ', color: C.sep },
        { text: compact ? clip(d.branch, 20) : `🌿${d.branch}`, color: C.branch },
        { text: branchMark, color: d.isDirty ? C.warn : C.ok },
      )
      if (!compact) workspace.push({ text: aheadBehind, color: C.branch })
    }
    if (d.pr) {
      workspace.push({ text: ' · ', color: C.sep }, { text: `(PR#${d.pr.number})`, color: C.pr, href: d.pr.url })
    }
    groups.push(workspace)

    const toggleLabel = compact ? (d.isOpen ? '−' : '+') : d.isOpen ? '▾ details' : '▸ details'
    const line = (
      // Full width and unshrinkable, so Claude's footer cannot squeeze it beside the auto-mode item; 4 columns
      // spare for the footer's padding. Groups don't shrink, so a line too wide wraps between groups, not mid-word
      <Box key="line" width={cols - 4} flexShrink={0} flexWrap="wrap">
        {groups.map((g, gi) => (
          <Box key={`group${gi}`} flexShrink={0}>
            {[...g, { text: ' │ ', color: C.sep }].map((s: Seg, i) =>
              s.onPress ? (
                <Button key="folder" plain onPress={s.onPress}>
                  <Text color={s.color}>{s.text}</Text>
                </Button>
              ) : s.href ? (
                <Link key={`seg${gi}-${i}`} href={s.href}>
                  <Text color={s.color}>{s.text}</Text>
                </Link>
              ) : (
                <Text key={`seg${gi}-${i}`} color={s.color} bold={s.bold}>
                  {s.text}
                </Text>
              ),
            )}
          </Box>
        ))}
        <Button
          key="toggle"
          plain
          dimColor={!d.isOpen}
          label={toggleLabel}
          onPress={() => setOpen($, !d.isOpen)}
        />
      </Box>
    )

    isWorking = e.props.isWorking

    // Claude's own hint row (its subagents display, esc to interrupt) is left out; the serf counter replaces it
    return line
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const d = await read($, data)
    const tick = await read($, frame)
    const now = await $.clock.now()
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const { ctxColor, fiveColor, weekColor, branchMark } = paint(d)
    const width = e.props.bodyColumns
    const textWidth = width - 15
    const running = d.agents.filter(a => a.status === 'running')
    const allFinished = d.agents
      .filter(a => a.status !== 'running')
      .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
    // Five rows at a time, running first; ▸ more shows the rest
    const ordered = [...running, ...allFinished]
    const shown = d.isAgentsExpanded ? ordered : ordered.slice(0, 5)
    const hiddenCount = ordered.length - shown.length
    // Smallest list first, ties alphabetical, so the order follows each person's own setup
    const loaded = (
      [
        ['hooks', d.hooks],
        ['mcp', d.mcp],
        ['mods', d.mods],
        ['skills', d.skills],
      ] as const
    )
      .slice()
      .sort(([an, a], [bn, b]) => a.length - b.length || an.localeCompare(bn))
    const laneWidth = Math.max(8, Math.min(30, width - 42))
    const openAgent = async (agentId: string | null) => {
      if (!agentId) return
      const r = await $.ui.view({ agentId })
      if (r.deny) $.ui.toast(`reeve: could not open agent: ${r.deny}`)
    }
    const viewedId = e.props.view.agentId
    const backToMain = async () => {
      const r = await $.ui.view({})
      if (r.deny) $.ui.toast(`reeve: could not go back: ${r.deny}`)
    }
    const gauge = 20
    const label = (text: string) => (
      <Box width={15} flexShrink={0}>
        <Text color={C.label}>{text}</Text>
      </Box>
    )
    const heading = (text: string) => <Text bold color={C.head}>{text}</Text>
    const blank = (k: string) => <Text key={k}> </Text>
    const toggleLoaded = () => update($, data, x => ({ ...x, isLoadedExpanded: !x.isLoadedExpanded }))
    const listRow = (k: string, name: string, items: string[]) => (
      <Box key={k}>
        {label(`${name} (${items.length})`)}
        <Box width={textWidth} flexDirection="column">
          {items.length === 0 && <Text>—</Text>}
          {byLetter(items).map(group => (
            <Text key={`${k}-${group[0]}`}>{group.join(', ')}</Text>
          ))}
        </Box>
      </Box>
    )

    // ponytail: side panel trial; the band version is backed up in the scratchpad as register.band.tsx
    const card = (
      <Box key="card" width={width} flexDirection="column">
        <Box justifyContent="space-between">
          <Text color={C.model} bold>
            🤖{prettyModel(d.model)}
            {d.contextWindow !== null && d.contextWindow >= 1_000_000 ? ' (1M)' : ''}
          </Text>
          <Text color={isWorking ? C.ok : C.label}>{isWorking ? '● working' : '○ idle'}</Text>
          <Button key="close" plain dimColor label="✕ close" onPress={() => setOpen($, false)} />
        </Box>
        <Text color={C.sep}>{'─'.repeat(Math.max(10, width - 4))}</Text>

        {heading('SESSION')}
        <Box>
          {label('effort')}
          <Text color={C.effort}>{d.effort ? `${effortBar(d.effort)} ${d.effort}` : '--'}</Text>
        </Box>
        <Box>{label('running')}<Text>{d.startedAt !== null ? duration(now - d.startedAt) : '--'}</Text></Box>
        <Box>{label('cost')}<Text color={C.cost}>{d.costUsd !== null ? `$${d.costUsd.toFixed(2)}` : '--'}</Text></Box>
        {blank('b1')}

        {heading('CONTEXT')}
        <Box>
          <Text color={ctxColor}>
            {bar(d.contextPercent, gauge)}  {pct(d.contextPercent)}
            {d.contextTokens !== null && d.contextWindow !== null
              ? ` · ${tokens(d.contextTokens)} / ${tokens(d.contextWindow)}`
              : ''}
            {'   '}
          </Text>
          <Button key="compact" label="⟲ compact" onPress={() => void $.session.compact()} />
        </Box>
        {d.contextRows.map(row => (
          <Box key={`ctx-${row.name}`}>
            {label(row.name)}
            <Text>{tokens(row.tokens)}</Text>
          </Box>
        ))}
        {d.autoCompactAt !== null && (
          <Box>{label('auto-compact')}<Text color={C.label}>at {d.autoCompactAt}%</Text></Box>
        )}
        {blank('b2')}

        {heading('USAGE LIMITS')}
        {d.fiveHour === null && d.sevenDay === null && <Text color={C.label}>no rate-limit data on this account</Text>}
        {d.fiveHour && (
          <Box>
            {label('5h')}
            <Text color={fiveColor} bold={isRateHot(d.fiveHour.percentUsed)}>
              {bar(d.fiveHour.percentUsed, gauge)} {pct(d.fiveHour.percentUsed).padStart(4)}
            </Text>
            <Text color={C.label}>
              {d.fiveHour.resetsAt
                ? `   resets in ${countdown(d.fiveHour.resetsAt, now)} (${resetClock(d.fiveHour.resetsAt, now)})`
                : ''}
            </Text>
            <Text color={fiveColor} bold>
              {rateMark(d.fiveHour.percentUsed)}
            </Text>
          </Box>
        )}
        {d.sevenDay && (
          <Box>
            {label('7d')}
            <Text color={weekColor} bold={isRateHot(d.sevenDay.percentUsed)}>
              {bar(d.sevenDay.percentUsed, gauge)} {pct(d.sevenDay.percentUsed).padStart(4)}
            </Text>
            <Text color={C.label}>
              {d.sevenDay.resetsAt
                ? `   resets in ${countdown(d.sevenDay.resetsAt, now)} (${resetClock(d.sevenDay.resetsAt, now)})`
                : ''}
            </Text>
            <Text color={weekColor} bold>
              {rateMark(d.sevenDay.percentUsed)}
            </Text>
          </Box>
        )}
        {blank('b3')}

        {heading('WORKSPACE')}
        <Box>
          <Button key="open-folder" plain onPress={() => openFolder($)}>
            <Text color={C.dir}>📁{shortPath(d.cwd, d.home)}</Text>
          </Button>
          {d.pr && <Text color={C.sep}> · </Text>}
          {d.pr && (
            <Link href={d.pr.url}>
              <Text color={C.pr}>(PR#{d.pr.number})</Text>
            </Link>
          )}
        </Box>
        {d.branch !== null ? (
          <Text color={C.branch}>
            🌿{d.branch}
            <Text color={d.isDirty ? C.warn : C.ok}>{branchMark}</Text>
            {` · ↑${d.ahead} ↓${d.behind} · ${d.changed} ${d.changed === 1 ? 'file' : 'files'} changed`}
          </Text>
        ) : (
          <Text color={C.label}>not a git repository</Text>
        )}
        {d.lastCommit && (
          <Box>
            {label('last commit')}
            <Box width={textWidth}>
              <Text>
                "{clip(d.lastCommit.subject, Math.max(20, width - 32))}"
                <Text color={C.label}> · {d.lastCommit.ago}</Text>
              </Text>
            </Box>
          </Box>
        )}
        <Text color={C.sep}>{'─'.repeat(width)}</Text>
        {viewedId !== undefined && (
          <Box key="back">
            <Button key="back" label="◂ back to main" onPress={backToMain} />
            <Text color={C.label}>
              {'  · viewing: '}
              {d.agents.find(a => a.agentId === viewedId)?.task ?? 'agent'}
            </Text>
          </Box>
        )}
        {viewedId !== undefined && <Text color={C.sep}>{'─'.repeat(width)}</Text>}
        <Box justifyContent="space-between">
          <Text>
            <Text bold color={C.head}>AGENTS</Text>
            <Text color={C.label}>{`  ${running.length} running · ${d.agents.length} total`}</Text>
          </Text>
          {(hiddenCount > 0 || d.isAgentsExpanded) && (
            <Button
              key="agents-more"
              plain
              dimColor
              label={d.isAgentsExpanded ? '▴ less' : `▸ more (${hiddenCount})`}
              onPress={() => update($, data, x => ({ ...x, isAgentsExpanded: !x.isAgentsExpanded }))}
            />
          )}
        </Box>
        {shown.length === 0 && <Text color={C.label}>{EMPTY_AGENTS[d.jokeIndex % EMPTY_AGENTS.length]}</Text>}
        {shown.map(a => {
          const isRunning = a.status === 'running'
          const mark = isRunning ? SPINNER[tick % SPINNER.length] : a.status === 'done' ? '✓' : '✗'
          const markColor = isRunning ? C.ctx : a.status === 'done' ? C.ok : C.error
          const runtime = clockText((a.endedAt ?? now) - a.startedAt)
          const timing = a.endedAt === null ? runtime : `${runtime} (${finishStamp(a.endedAt)})`
          const tags = [shortModel(a.model), a.isBackground ? 'bg' : null].filter(Boolean).join(' · ')
          const title = clip(`${a.type} · ${a.task}`, Math.max(10, width - timing.length - tags.length - 8))

          return (
            <Box key={`agent-${a.id}`} flexDirection="column">
              <Box justifyContent="space-between">
                <Box>
                  <Text color={markColor}>{mark} </Text>
                  {isRunning && a.agentId ? (
                    <Button key={`open-${a.id}`} plain onPress={() => openAgent(a.agentId)}>
                      <Text color={C.agent}>{title}</Text>
                    </Button>
                  ) : (
                    // finished agents drop off Claude's tasks list, so they cannot be opened
                    <Text color={C.agent} dimColor>
                      {title}
                    </Text>
                  )}
                  {tags && <Text color={C.label}>{`  ${tags}`}</Text>}
                </Box>
                <Text color={isRunning ? C.fiveHour : C.label}>{timing}</Text>
              </Box>
              <Text color={C.label}>
                {'  '}
                <Text color={markColor}>{lane(a.status, tick, laneWidth)}</Text>
                {`  ${a.steps} ${a.steps === 1 ? 'step' : 'steps'} · ${tokens(a.ctx)} ctx · ${tokens(a.output)} out`}
                {a.hitMaxTokens ? <Text color={C.error}> · ⚠ max tokens</Text> : ''}
                {a.lastTool ? <Text color={C.branch}>{` · → ${a.lastTool}`}</Text> : ''}
              </Text>
              {a.preview && !isRunning && (
                <Text color={C.label} dimColor>
                  {`  ↳ ${clip(a.preview, Math.max(10, width - 4))}`}
                </Text>
              )}
            </Box>
          )
        })}
        <Text color={C.sep}>{'─'.repeat(width)}</Text>

        <Button key="loaded" plain onPress={toggleLoaded}>
          <Text bold color={C.head}>LOADED</Text>
          <Text>
            {`   ${loaded.map(([name, items]) => `${name} (${items.length})`).join(' · ')}   `}
          </Text>
          <Text color={C.label}>{d.isLoadedExpanded ? '▴ less' : '▸ more'}</Text>
        </Button>
        {d.isLoadedExpanded && loaded.map(([name, items]) => listRow(`l-${name}`, name, items))}
      </Box>
    )

    return card
  })
}
