export type FileStat = { path: string; added: number; removed: number; isBinary: boolean; isUntracked: boolean }

export type Status = 'idle' | 'loading' | 'ready' | 'error'

export type LensView = {
  base: string
  mergeBase: string
  bases: string[]
  stats: FileStat[]
  file: string | null
  line: number | null
  isFlashing: boolean
  diff: string
  isTruncated: boolean
  status: Status
  message: string
  isListOpen: boolean
  isBasePickerOpen: boolean
  expanded: number[]
  change: number
  shown: number
  aim: number
}

declare module 'claude-code' {
  interface PluginState {
    'diff-lens': { view: LensView }
  }
}
