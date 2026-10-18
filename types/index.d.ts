export type RateWindow = { percentUsed: number; resetsAt?: string } | null

export type ContextRow = { name: string; tokens: number }

export type AgentRow = {
  id: string
  agentId: string | null
  type: string
  task: string
  startedAt: number
  endedAt: number | null
  status: 'running' | 'done' | 'failed'
  steps: number
  ctx: number
  output: number
  hitMaxTokens: boolean
  model: string | null
  isBackground: boolean
  preview: string | null
  lastTool: string | null
}

export type HudData = {
  model: string | null
  effort: string | null
  cwd: string | null
  home: string | null
  branch: string | null
  isDirty: boolean
  ahead: number
  behind: number
  changed: number
  lastCommit: { subject: string; ago: string } | null
  pr: { number: number; url: string } | null
  contextPercent: number | null
  contextTokens: number | null
  contextWindow: number | null
  contextRows: ContextRow[]
  autoCompactAt: number | null
  fiveHour: RateWindow
  sevenDay: RateWindow
  costUsd: number | null
  startedAt: number | null
  mods: string[]
  skills: string[]
  hooks: string[]
  mcp: string[]
  agents: AgentRow[]
  jokeIndex: number
  isOpen: boolean
  isLoadedExpanded: boolean
  isAgentsExpanded: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'reeve': { data: HudData; frame: number }
  }
}
