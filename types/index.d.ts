/** The scene's state: idle, typing, working, done, stopped. */
export type Phase = 'idle' | 'typing' | 'working' | 'done' | 'stopped'

export type Sea = {
  phase: Phase
  /** Whether bubbles rise: a tool is running or finished moments ago. */
  full: boolean
  /** Bumped on every state change; a timer only resets its own state. */
  seq: number
  /** The swim clock when the speed last changed (seconds at speed 1). */
  clock: number
  /** When the speed last changed (ms). */
  since: number
  /** Current speed: how far the swim clock moves per real second. */
  rate: number
}

declare module 'claude-code' {
  interface PluginState {
    'pixel-sharks': {
      sea: Shaped<Sea>
      tools: Shaped<number>
      /** Finished tool calls so far: the bubble timer checks it before clearing. */
      ends: Shaped<number>
    }
  }
}
