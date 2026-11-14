import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ThemeSetArgs } from 'claude-code'

import type { Phase, Scare, Sea } from '../types'
import { theme } from './palette'
import { buildScene, sceneAlt } from './scene'
import { shift, swimAt } from './swim'

const SCENE = 'deep'
const DONE_MS = 9000
const STOPPED_MS = 6000
// Bubbles stay up for one full rise after the last tool ends: most tools finish in milliseconds.
const HOLD_MS = 6500
// How long the sharks flee after a failed Bash command (the animation is 6 s).
const SCARE_MS = 6200

// Change the shape tag when the value's shape changes: new code then ignores what old code stored.
const sea = atom(
  { plugin: 'pixel-sharks', key: 'sea' } as const,
  { phase: 'idle', full: false, seq: 0, clock: 0, since: 0, rate: 1 },
  { shape: 'sea-1' },
)
const tools = atom({ plugin: 'pixel-sharks', key: 'tools' } as const, 0, { shape: 'tools-1' })
// Counts finished tool calls, so a bubble timer only clears the bubbles if no newer call came.
const ends = atom({ plugin: 'pixel-sharks', key: 'ends' } as const, 0, { shape: 'ends-1' })
// `n` counts failed Bash commands, so a scatter timer only ends its own scatter.
const scare = atom({ plugin: 'pixel-sharks', key: 'scare' } as const, { n: 0, on: false } as Scare, { shape: 'scare-1' })

// Blur behind the text: a dark frosted glass softens the sharks so text stays easy to read.
const LOOK: ThemeSetArgs = {
  colors: theme,
  backdrop: { scene: SCENE, glass: { blur: 14, tint: '#000000', opacity: 0.5 } },
}

type Dollar = Pick<EngineInterface, 'state' | 'clock'>

/** Writes the state only when it really changes: every write redraws the scene. */
async function enter($: Dollar, phase: Phase, full?: boolean): Promise<Sea> {
  const cur = await read($, sea)
  const f = full ?? cur.full

  if (cur.phase === phase && cur.full === f) {
    return cur
  }
  const now = await $.clock.now()

  return update($, sea, s => shift(s, now, phase, f))
}

/** Starts a scatter and ends it after SCARE_MS, unless a newer one started meanwhile. */
async function scatter($: Dollar): Promise<void> {
  const { n: tick } = await update($, scare, c => ({ n: c.n + 1, on: true }))

  $.clock.after(SCARE_MS, () => {
    void read($, scare).then(c => (c.on && c.n === tick ? update($, scare, x => ({ ...x, on: false })) : c))
  })
}

async function setFull($: Dollar, full: boolean): Promise<void> {
  const cur = await read($, sea)

  if (cur.phase === 'working' && cur.full !== full) {
    await enter($, 'working', full)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, tools, () => 0)
    // A reload drops pending timers: a scatter must not stay on for good.
    await update($, scare, c => ({ ...c, on: false }))
    // The clock starts at zero on first load and carries on across reloads.
    await update($, sea, s => (s.since === 0 ? { ...shift(s, now, 'idle', false), clock: 0 } : shift(s, now, 'idle', false)))
    // A build that doesn't take `colors` still draws the backdrop.
    // With no app attached yet the theme waits and draws once one attaches;
    // nothing goes to the status line, or a stale note would stay there.
    $.ui.status(undefined)
    await $.theme.set(LOOK).catch(() => $.theme.set({ backdrop: LOOK.backdrop }))

    return next(e)
  })

  // Main loop only: a subagent finishing must not mark the whole turn done.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const busy = await read($, tools)
      await enter($, 'working', busy > 0)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)

    if (e.agentId === undefined) {
      const phase: Phase = e.reason === 'answer' ? 'done' : 'stopped'
      const s = await enter($, phase, false)
      const seq = s.seq

      $.clock.after(phase === 'done' ? DONE_MS : STOPPED_MS, () => {
        void read($, sea).then(cur => (cur.seq === seq ? enter($, 'idle') : cur))
      })
    }

    return done
  })

  // Tool calls are counted, so parallel or failing calls can't confuse the state.
  on('tool.call', async ($, e, next) => {
    const busy = await update($, tools, n => n + 1)

    if (busy === 1) {
      await setFull($, true)
    }
    try {
      const result = await next(e)

      // A Bash command that failed makes the sharks flee.
      if (e.tool === 'Bash' && result.isError === true) {
        await scatter($)
      }

      return result
    } finally {
      const left = await update($, tools, n => Math.max(0, n - 1))

      if (left === 0) {
        const tick = await update($, ends, n => n + 1)

        $.clock.after(HOLD_MS, () => {
          void Promise.all([read($, tools), read($, ends)]).then(([busy, last]) =>
            busy === 0 && last === tick ? setFull($, false) : undefined,
          )
        })
      }
    }
  }).catch(($, e, next) => next(e)) // the tool always runs; if it already ran, its result is replayed

  // Typing in the prompt box sends sonar rings; clearing it stops them.
  on('prompt.change', async ($, e, next) => {
    const result = await next(e)
    const cur = await read($, sea)
    const hasText = e.text.trim() !== ''

    if (cur.phase === 'idle' && hasText) {
      await enter($, 'typing')
    } else if (cur.phase === 'typing' && !hasText) {
      await enter($, 'idle')
    }

    return result
  })

  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    if ((e.surface !== 'desktop' && e.surface !== 'mobile') || e.props.plugin !== 'pixel-sharks' || e.props.scene !== SCENE) {
      return next(e)
    }
    const { Svg } = $.ui.resolve(e)
    const s = await read($, sea)
    const { on: scared } = await read($, scare)
    const now = await $.clock.now()

    return <Svg source={buildScene(s.phase, swimAt(s, now), s.rate, s.full, scared)} alt={sceneAlt(s.phase, scared)} isInteractive />
  })
}
