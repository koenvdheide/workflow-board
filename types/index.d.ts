export type Kind = 'find' | 'decide' | 'ask' | 'challenge' | 'confirm' | 'claim'
export type Conf = 'lo' | 'mid' | 'hi'

// One board entry. Its id is its position in the run's log, from 1, so it is never stored.
export type Entry = { by: string; kind: Kind; head: string; body?: string; ev?: string[]; re?: number; tags?: string[]; conf?: Conf }

// An agent that has used the board: its handle and its read position (the id read up to).
export type AgentRow = { h: string; cur: number }

export type Run = { entries: Entry[]; agents: Record<string, AgentRow> }

declare module 'claude-code' {
  interface PluginState {
    'findings-board': { run: StateFamily<Run>; bind: StateFamily<string> }
  }
}
