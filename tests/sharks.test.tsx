import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { Phase } from '../types'
import { buildScene, closes, legs, SHARKS } from '../hooks/scene'

const BACKDROP = {
  plugin: 'pixel-sharks',
  component: 'Backdrop',
  props: { scene: 'deep', plugin: 'pixel-sharks', glass: { blur: 14, opacity: 0.5 } },
} as const

/** Balanced tags, no bare < or & in text: a malformed SVG draws nothing at all. */
function wellFormed(xml: string): string | undefined {
  const stack: string[] = []
  const tag = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"<&]*")*)\s*(\/?)>/y
  let i = 0

  while (i < xml.length) {
    const lt = xml.indexOf('<', i)
    const text = xml.slice(i, lt === -1 ? xml.length : lt)

    if (/&(?!amp;|lt;|gt;|quot;|apos;)/.test(text)) {
      return `bare & (${i})`
    }
    if (lt === -1) {
      break
    }
    tag.lastIndex = lt
    const m = tag.exec(xml)

    if (m === null) {
      return `bad tag: ${xml.slice(lt, lt + 50)}`
    }
    const [, close, name = '', , self] = m

    if (close === '/') {
      if (stack.pop() !== name) {
        return `unmatched </${name}>`
      }
    } else if (self !== '/') {
      stack.push(name)
    }
    i = tag.lastIndex
  }

  return stack.length > 0 ? `unclosed: ${stack.join(', ')}` : undefined
}

test('every state draws a valid SVG under the size limit', async () => {
  for (const phase of ['idle', 'typing', 'working', 'done', 'stopped'] as Phase[]) {
    const svg = buildScene(phase, 123.4, 2.2)
    expect(wellFormed(svg)).toBe(undefined)
    expect(svg.length < 131072).toBe(true)
  }
})

test('every path closes and every leg is a valid direction of at least one block', async () => {
  for (const s of SHARKS) {
    expect(closes(s)).toBe(true)

    for (const l of legs(s)) {
      expect(l.len >= 1).toBe(true)
      expect(l.dir >= 0 && l.dir <= 7).toBe(true)
    }
  }
})

async function source(ui: { find: (q: { type: string }) => Promise<{ props: Record<string, unknown> } | undefined> }) {
  const svg = await ui.find({ type: 'Svg' })

  return String(svg?.props.source ?? '')
}

/** Where the first shark is on its loop (0–1), read from the scene's CSS. */
function firstSharkAt(svg: string): { at: number; dur: number } {
  const m = /\.mv0,\.or0,\.fa0,\.fb0\{animation-duration:([\d.]+)s;animation-delay:-([\d.]+)s\}/.exec(svg)

  return m === null ? { at: -1, dur: -1 } : { at: Number(m[2]) / Number(m[1]), dur: Number(m[1]) }
}

function engine(on: On) {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'look' } }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
}

test('the scene stays plain while Claude works and settles back after it is done', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  engine(on)
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...BACKDROP, surface })
    expect(firstSharkAt(await source(ui)).dur).toBe(40)
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop' })
  await $.turn.start({ text: 'hello', turnId: 't1' })
  expect(firstSharkAt(await source(ui)).dur).toBe(40)
  // No bubbles until a tool runs.
  expect(await source(ui)).not.toContain('class="bub')

  // A subagent's turn leaves the scene alone.
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'a1', agentId: 'helper', reason: 'answer' })
  await $.turn.complete({ answer: 'ok', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(await source(ui)).not.toContain('<g class="dim">')

  await clock.advance(9500)
  expect(firstSharkAt(await source(ui)).dur).toBe(40)
  await ui.unmount()
})

test('bubbles rise when a tool runs, stay up for one rise, and the sharks never jump', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  let during = ''
  let ui: Awaited<ReturnType<typeof $.ui.mount<'desktop', 'Backdrop'>>> | undefined
  engine(on)
  on('tool.call', async () => {
    during = ui === undefined ? '' : await source(ui)

    return { result: {} }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop' })
  await $.turn.start({ text: 'x', turnId: 't2' })
  await clock.advance(5000)
  await $.tool.call({ tool: 'Bash', command: 'ls' })

  expect(during).toContain('class="bub bd0"')
  // Tools finish in milliseconds, so the bubbles stay up for one full rise.
  expect(await source(ui)).toContain('class="bub bd0"')
  await clock.advance(7000)
  const after = await source(ui)
  expect(after).not.toContain('class="bub')

  // Five seconds in the first shark is 12.5% into its 40-second loop. The bubbles clear
  // 6.5 seconds later, and the scene redrawn then has it 28.75% round: no jump.
  const fast = firstSharkAt(during)
  const slow = firstSharkAt(after)
  expect(Math.abs(fast.at - 0.125) < 0.002).toBe(true)
  expect(Math.abs(slow.at - 0.2875) < 0.002).toBe(true)
  await ui.unmount()
})

test('a new tool call inside the hold keeps the bubbles up', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  engine(on)
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop' })
  await $.turn.start({ text: 'x', turnId: 't4' })
  await $.tool.call({ tool: 'Read', file_path: '/a' })
  await clock.advance(4000)
  await $.tool.call({ tool: 'Read', file_path: '/b' })
  await clock.advance(4000)
  expect(await source(ui)).toContain('class="bub bd0"')

  await clock.advance(3000)
  expect(await source(ui)).not.toContain('class="bub')
  await ui.unmount()
})

test('an interrupted turn dims the sharks for a moment, then they come back', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  engine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BACKDROP, surface: 'desktop' })
  await $.turn.start({ text: 'x', turnId: 't3' })
  await $.turn.complete({ answer: '', durationMs: 5, isAborted: true, turnId: 't3', reason: 'aborted' })
  expect(await source(ui)).toContain('<g class="dim">')

  await clock.advance(6500)
  expect(await source(ui)).not.toContain('<g class="dim">')
  await ui.unmount()
})

test('leaves another mod\'s backdrop alone', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  const ui = await $.ui.mount({
    ...BACKDROP,
    surface: 'desktop',
    props: { scene: 'other', plugin: 'other-mod', glass: false },
  })

  expect(await ui.find({ type: 'Svg' })).toBe(undefined)
  await ui.unmount()
})
