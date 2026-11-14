import type { Phase } from '../types'

// Real pixel art: each shark is rasterized once, at load, into whole
// single-colour blocks (a straight and a diagonal drawing, two tail poses).
// Sharks move one whole block per step in 8 directions; 90° turns keep the
// blocks on the grid. A fixed black grid on top opens the gaps between
// blocks. No SVG filters: the app strips them when it sanitizes the scene.

const CELL = 6
const GAP = 1.2

const r1 = (v: number) => Math.round(v * 10) / 10
const r2 = (v: number) => Math.round(v * 100) / 100

function rng(seed: number): () => number {
  let s = seed >>> 0

  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Four greys; the lightest is toned down so it never competes with text.
const LEVEL = ['', '#2e2e2e', '#666666', '#a3a3a3', '#d6d6d6']
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16)

type Species = {
  wmax: number
  snout: number
  tailEnd: number
  pect: readonly [number, number, number, number]
  base: number
  hammer?: boolean
  spots?: boolean
}

const SPECIES = {
  white: { wmax: 0.1, snout: 0.13, tailEnd: 1.0, pect: [0.21, 0.35, 0.43, 0.16], base: 0.55 },
  hammer: { wmax: 0.085, snout: 0.06, tailEnd: 1.02, pect: [0.22, 0.33, 0.4, 0.13], base: 0.5, hammer: true },
  whale: { wmax: 0.135, snout: 0.08, tailEnd: 1.0, pect: [0.19, 0.34, 0.42, 0.19], base: 0.36, spots: true },
  thresher: { wmax: 0.08, snout: 0.12, tailEnd: 1.6, pect: [0.22, 0.34, 0.42, 0.15], base: 0.5 },
} satisfies Record<string, Species>

function inTri(u: number, v: number, a: readonly number[], b: readonly number[], c: readonly number[]): boolean {
  const [ax = 0, ay = 0] = a
  const [bx = 0, by = 0] = b
  const [cx = 0, cy = 0] = c
  const d1 = (u - bx) * (ay - by) - (ax - bx) * (v - by)
  const d2 = (u - cx) * (by - cy) - (bx - cx) * (v - cy)
  const d3 = (u - ax) * (cy - ay) - (cx - ax) * (v - ay)

  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
}

/** Lightness (0–1) of a top-down shark at a point, or -1 outside it. */
function tone(sp: Species, u: number, v: number, L: number, bendPhase: number): number {
  if (!(u >= -0.03 && u <= sp.tailEnd + 0.02)) {
    return -1
  }
  const bend = L * 0.07 * Math.sin(2 * Math.PI * 0.85 * u + bendPhase) * Math.pow(Math.max(0, 0.12 + Math.min(u, 1.2)), 1.4)
  const vv = v - bend
  const av = Math.abs(vv) / L

  if (sp.hammer === true && u < 0.075) {
    const half = 0.2 - 0.25 * Math.max(0, u - 0.03)

    if (av < half) {
      return Math.abs(av - (half - 0.018)) < 0.018 && u < 0.05 ? 0.04 : sp.base + 0.08
    }
  }
  if (u >= 0 && u <= 0.86) {
    const f = u < sp.snout ? Math.sqrt(u / sp.snout) : u < 0.3 ? 1 : Math.max(0.08, 1 - Math.pow((u - 0.3) / 0.56, 1.6))
    const hw = sp.wmax * f

    if (av < hw) {
      if (sp.hammer !== true && u > sp.snout * 0.45 && u < sp.snout * 0.45 + 0.03 && Math.abs(av - hw * 0.72) < 0.014) {
        return 0.04
      }
      if (u > 0.3 && u < 0.46 && av < 0.011) {
        return sp.base - 0.22
      }
      if (sp.spots === true) {
        const s2 = Math.sin(u * L * 1.15) * Math.sin(vv * 1.25 + u * 4)

        if (s2 > 0.82 && av < hw * 0.9) {
          return 0.92
        }
      }

      return sp.base + 0.28 * Math.pow(av / hw, 2)
    }
  }
  const p = sp.pect
  const wAt = sp.wmax * 0.95

  if (inTri(u, av, [p[0], wAt * 0.7], [p[1], wAt * 0.7], [p[2], wAt + p[3]])) {
    return sp.base - 0.08
  }
  if (inTri(u, av, [0.6, 0.03], [0.66, 0.03], [0.69, 0.065])) {
    return sp.base - 0.06
  }
  if (u > 0.84 && u < sp.tailEnd) {
    const q = (u - 0.84) / (sp.tailEnd - 0.84)
    const tw = 0.018 * (1 - q) + 0.005 + (q > 0.82 ? 0.012 * Math.sin(((q - 0.82) / 0.18) * Math.PI) : 0)

    if (av < tw) {
      return sp.base - 0.04
    }
  }

  return -1
}

/**
 * Rasterizes a shark onto the block grid: one path per grey level, each run
 * of blocks in a row drawn as one thick line. The centre sits on a block
 * corner, so 90° rotations land the blocks back on the grid.
 */
function sprite(sp: Species, L: number, angleDeg: number, bendPhase: number): string {
  const R = Math.ceil(L * (Math.max(0.5, sp.tailEnd - 0.4) + 0.08)) + 1
  const a = (angleDeg * Math.PI) / 180
  const ca = Math.cos(a)
  const sa = Math.sin(a)
  const rows: string[] = ['', '', '', '', '']

  for (let j = -R; j < R; j++) {
    let runLevel = 0
    let runStart = 0

    for (let i = -R; i <= R; i++) {
      let level = 0

      if (i < R) {
        const x = i + 0.5
        const y = j + 0.5
        const along = x * ca + y * sa
        const perp = -x * sa + y * ca
        const t = tone(sp, (0.45 * L - along) / L, perp, L, bendPhase)

        if (t >= 0) {
          const ink = 0.12 + t * 0.85
          level = Math.max(1, Math.min(4, Math.floor(ink * 4 + (BAYER[(j & 3) * 4 + (i & 3)] ?? 0.5) - 0.5)))
        }
      }
      if (level !== runLevel) {
        if (runLevel > 0) {
          rows[runLevel] += `M${runStart * CELL} ${j * CELL + CELL / 2}h${(i - runStart) * CELL}`
        }
        runLevel = level
        runStart = i
      }
    }
  }

  return rows.map((d, l) => (d === '' ? '' : `<path d="${d}" stroke="${LEVEL[l]}" stroke-width="${CELL}" fill="none"/>`)).join('')
}

// ------------------------------------------------------------- paths

/** Directions: 0 east, 1 south-east, 2 south … 7 north-east (y points down). */
const DIRS = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
] as const

export type Shark = {
  sp: keyof typeof SPECIES
  /** Length, in blocks. */
  L: number
  /** The block the path starts on. */
  start: readonly [number, number]
  /** A closed path: [direction, blocks] legs. */
  path: readonly (readonly [number, number])[]
  /** Seconds per loop at speed 1. */
  D: number
  /** Seconds per tail beat at speed 1. */
  F: number
}

/** An octagon whose long sides carry a small zigzag; it always closes. */
function octagon(a: number, b: number, c: number, zig: number, cw: boolean): [number, number][] {
  const half = Math.floor(a / 2)
  const order = cw ? [0, 1, 2, 3, 4, 5, 6, 7] : [4, 3, 2, 1, 0, 7, 6, 5]
  const out: [number, number][] = []

  for (const d of order) {
    if (d % 4 === 0 && zig === 0) {
      out.push([d, a])
    } else if (d === 0) {
      out.push([0, half - zig], [7, zig], [0, a - half - zig], [1, zig])
    } else if (d === 4) {
      out.push([4, half - zig], [3, zig], [4, a - half - zig], [5, zig])
    } else if (d % 2 === 0) {
      out.push([d, c])
    } else {
      out.push([d, b])
    }
  }

  return out
}

/** The point the patrolling hammerhead circles, in blocks: the top of the right lane. */
export const PATROL_X = 245
export const PATROL_Y = 38

// The sharks swim in the empty lanes either side of the chat column: the left
// lane is ~17–34% of the window width (x 45–90 blocks), the right ~83–100% (x 222–267).
export const SHARKS: readonly Shark[] = [
  { sp: 'white', L: 36, start: [248, 78], path: octagon(6, 8, 56, 0, false), D: 40, F: 1.2 },
  { sp: 'hammer', L: 32, start: [77, 96], path: octagon(6, 8, 36, 0, false), D: 32, F: 1.1 },
  { sp: 'whale', L: 46, start: [65, 22], path: octagon(4, 6, 110, 0, true), D: 90, F: 2 },
  { sp: 'thresher', L: 28, start: [63, 10], path: octagon(6, 8, 40, 0, false), D: 32, F: 1 },
  // A small hammerhead patrolling the top of the right lane.
  { sp: 'hammer', L: 24, start: [PATROL_X - 5, PATROL_Y - 23], path: octagon(10, 10, 26, 0, true), D: 30, F: 1 },
]

/** Each leg of a path: start block, direction, length and where it starts in the loop (0–1). */
export function legs(s: Shark): { x: number; y: number; dir: number; len: number; at: number }[] {
  const total = s.path.reduce((n, [, len]) => n + len, 0)
  const out: { x: number; y: number; dir: number; len: number; at: number }[] = []
  let [x, y] = s.start
  let done = 0

  for (const [dir, len] of s.path) {
    out.push({ x, y, dir, len, at: done / total })
    const [dx, dy] = DIRS[dir] ?? [0, 0]
    x += dx * len
    y += dy * len
    done += len
  }

  return out
}

/** Whether a path returns to its start block (for tests). */
export function closes(s: Shark): boolean {
  let [x, y] = s.start

  for (const [dir, len] of s.path) {
    const [dx, dy] = DIRS[dir] ?? [0, 0]
    x += dx * len
    y += dy * len
  }

  return x === s.start[0] && y === s.start[1]
}

// ------------------------------------------------------ fixed parts

const pct = (v: number) => `${r2(v * 100)}%`
const rotOf = (dir: number) => 90 * Math.floor(dir / 2)

const SPRITES = SHARKS.map(s => {
  const sp: Species = SPECIES[s.sp]

  return [0, 45].map(angle => [Math.PI / 2, -Math.PI / 2].map(phase => sprite(sp, s.L, angle, phase)))
})

const KEYFRAMES = SHARKS.map((s, i) => {
  const ls = legs(s)
  const first = ls[0]
  let mv = ''
  let or = ''
  let fa = ''
  let fb = ''

  for (const l of ls) {
    mv += `${pct(l.at)}{transform:translate(${l.x * CELL}px,${l.y * CELL}px);animation-timing-function:steps(${l.len},end)}`
    or += `${pct(l.at)}{transform:rotate(${rotOf(l.dir)}deg)}`
    fa += `${pct(l.at)}{opacity:${l.dir % 2 === 0 ? 1 : 0}}`
    fb += `${pct(l.at)}{opacity:${l.dir % 2 === 0 ? 0 : 1}}`
  }
  if (first !== undefined) {
    mv += `100%{transform:translate(${first.x * CELL}px,${first.y * CELL}px)}`
    or += `100%{transform:rotate(${rotOf(first.dir)}deg)}`
    fa += `100%{opacity:${first.dir % 2 === 0 ? 1 : 0}}`
    fb += `100%{opacity:${first.dir % 2 === 0 ? 0 : 1}}`
  }

  return `@keyframes mv${i}{${mv}}@keyframes or${i}{${or}}@keyframes fa${i}{${fa}}@keyframes fb${i}{${fb}}` +
    `.mv${i}{animation-name:mv${i}}.or${i}{animation-name:or${i}}.fa${i}{animation-name:fa${i}}.fb${i}{animation-name:fb${i}}`
}).join('')

/** A black grid fixed to the screen: the gaps between blocks. */
const GRID = (() => {
  let d = ''

  for (let x = -402 + CELL - GAP / 2; x < 2000; x += CELL) {
    d += `M${r1(x)} -400V1400`
  }
  for (let y = -402 + CELL - GAP / 2; y < 1400; y += CELL) {
    d += `M-400 ${r1(y)}H2000`
  }

  return `<path d="${d}" stroke="#000" stroke-width="${GAP}" fill="none"/>`
})()

const SPECKS = (() => {
  const rand = rng(31)
  let d1 = ''
  let d2 = ''

  for (let k = 0; k < 150; k++) {
    const x = Math.floor(rand() * 290 - 10) * CELL
    const y = Math.floor(rand() * 180 - 6) * CELL
    const seg = `M${x} ${y + CELL / 2}h${CELL}`

    if (rand() < 0.3) {
      d1 += seg
    } else {
      d2 += seg
    }
  }

  return `<path d="${d1}" stroke="#3a3a3a" stroke-width="${CELL}" fill="none"/><path d="${d2}" stroke="#242424" stroke-width="${CELL}" fill="none"/>`
})()

/** Turns a set of blocks into one path per grey level, row by row. */
function blocks(cells: Iterable<readonly [number, number, number]>): string {
  const rows = new Map<string, Map<number, number[]>>()

  for (const [i, j, level] of cells) {
    const key = `${level}`
    const byRow = rows.get(key) ?? new Map<number, number[]>()
    const row = byRow.get(j) ?? []
    row.push(i)
    byRow.set(j, row)
    rows.set(key, byRow)
  }
  let out = ''

  for (const [level, byRow] of rows) {
    let d = ''

    for (const [j, xs] of byRow) {
      const sorted = [...new Set(xs)].sort((a, b) => a - b)
      let runStart = sorted[0] ?? 0
      let prev = runStart

      for (const x of [...sorted.slice(1), Number.NaN]) {
        if (x !== prev + 1) {
          d += `M${runStart * CELL} ${j * CELL + CELL / 2}h${(prev - runStart + 1) * CELL}`
          runStart = x
        }
        prev = x
      }
    }
    out += `<path d="${d}" stroke="${LEVEL[Number(level)]}" stroke-width="${CELL}" fill="none"/>`
  }

  return out
}

/** Columns of bubbles rising from the sea floor while a tool runs. */
const BUBBLE_DELAYS: number[] = []

const BUBBLES = (() => {
  const rand = rng(91)
  let out = ''

  ;[52, 82, 236, 256].forEach((col, c) => {
    for (let k = 0; k < 5; k++) {
      const big = rand() < 0.35
      const cells: [number, number, number][] = big
        ? [[0, 0, 3], [1, 0, 3], [0, 1, 3], [1, 1, 2]]
        : [[0, 0, 3]]
      const x = col + Math.floor((rand() - 0.5) * 8)
      BUBBLE_DELAYS.push(r2(k * 1.3 + c * 0.45))
      out += `<g transform="translate(${x * CELL} ${170 * CELL})"><g class="bub bd${BUBBLE_DELAYS.length - 1}">` +
        `<g class="wob${k % 2}">${blocks(cells)}</g></g></g>`
    }
  })

  return out
})()

/** Sonar rings (half circles) spreading up from the bottom while you type. */
const SONAR = (() => {
  let out = ''

  for (let k = 0; k < 8; k++) {
    const r = 4 + k * 4
    const cells: [number, number, number][] = []

    for (let j = -r - 1; j <= 0; j++) {
      for (let i = -r - 1; i <= r; i++) {
        if (Math.abs(Math.hypot(i + 0.5, j + 0.5) - r) < 0.6) {
          cells.push([i, j, k < 3 ? 3 : k < 6 ? 2 : 1])
        }
      }
    }
    out += `<g class="sn sd${k}" opacity="0">${blocks(cells)}</g>`
  }

  return `<g transform="translate(${67 * CELL} ${166 * CELL})">${out}</g>`
})()

const CSS =
  '.mv,.or,.fa,.fb,.bub,.wob0,.wob1{transform-box:view-box}' +
  '.mv,.or,.fa,.fb{animation-iteration-count:infinite}' +
  '.or,.fa,.fb{animation-timing-function:steps(1,end)}' +
  '.k0,.k1{animation:flk 1s steps(1,end) infinite}' +
  '@keyframes flk{0%{opacity:1}50%{opacity:0}}' +
  '.bub{animation:rise 6.5s steps(170,end) infinite}@keyframes rise{from{transform:translateY(0)}to{transform:translateY(-1100px)}}' +
  '.wob0,.wob1{animation:wob 1.2s steps(1,end) infinite}.wob1{animation-delay:-.6s}@keyframes wob{0%{transform:translateX(0)}50%{transform:translateX(6px)}}' +
  '.sn{animation:sn 3s steps(1,end) infinite}@keyframes sn{0%{opacity:1}10%{opacity:0}100%{opacity:0}}' +
  Array.from({ length: 8 }, (_, k) => `.sd${k}{animation-delay:${r2(k * 0.3)}s}`).join('') +
  BUBBLE_DELAYS.map((d, k) => `.bd${k}{animation-delay:-${d}s}`).join('') +
  '.dim{animation:dim 1.6s steps(8,end) 2}@keyframes dim{0%{opacity:1}50%{opacity:.12}100%{opacity:1}}' +
  KEYFRAMES

/**
 * A failed Bash command scatters the sharks: each one darts away from the
 * middle of the screen, two blocks a step, holds, then swims back to its
 * loop. The dart is short enough to keep it on screen. Tails flick fast
 * while it lasts.
 */
const SCATTER = SHARKS.map((s, i) => {
  const dx = s.start[0] < 133 ? -120 : 120
  const dy = s.start[1] < 83 ? -60 : 60
  const at = (x: number, y: number) => `{transform:translate(${x}px,${y}px)}`

  return `.scat .s${i}{animation:sc${i} 2.4s steps(10,end) 1}` +
    `@keyframes sc${i}{0%${at(0, 0)}15%${at(dx, dy)}70%${at(dx, dy)}100%${at(0, 0)}}` +
    `.scat .s${i} .k0,.scat .s${i} .k1{animation-duration:.24s}.scat .s${i} .k1{animation-delay:-.12s}`
}).join('')

// ------------------------------------------------------------ states

/**
 * `clock`: the swim clock (seconds at speed 1), `rate`: the current speed.
 * Each shark is `clock mod D` into its loop; the CSS duration is D/rate and
 * the delay is minus that progress, so a speed change never makes it jump.
 */
export function timing(clock: number, rate: number): string {
  const v = Math.max(0.05, rate)

  return SHARKS.map((s, i) => {
    const at = ((clock % s.D) + s.D) % s.D
    const flick = r2(s.F / Math.pow(v, 0.6))

    return `.mv${i},.or${i},.fa${i},.fb${i}{animation-duration:${r2(s.D / v)}s;animation-delay:-${r2(at / v)}s}` +
      `.s${i} .k0,.s${i} .k1{animation-duration:${flick}s}.s${i} .k1{animation-delay:-${r2(flick / 2)}s}`
  }).join('')
}

/**
 * The scene for the current state; `full` says whether bubbles rise, `scared`
 * whether the sharks are scattering after a failed Bash command.
 */
export function buildScene(phase: Phase, clock: number, rate: number, full = false, scared = false): string {
  const sharks = SHARKS.map((s, i) => {
    const first = legs(s)[0]
    const isDiag = (first?.dir ?? 0) % 2 === 1
    const fam = (k: number) => {
      const [k0, k1] = SPRITES[i]?.[k] ?? ['', '']

      return `<g class="k0">${k0}</g><g class="k1" opacity="0">${k1}</g>`
    }

    return (
      `<g class="s${i}"><g class="mv mv${i}" transform="translate(${(first?.x ?? 0) * CELL} ${(first?.y ?? 0) * CELL})">` +
      `<g class="or or${i}" transform="rotate(${rotOf(first?.dir ?? 0)})">` +
      `<g class="fa fa${i}"${isDiag ? ' opacity="0"' : ''}>${fam(0)}</g>` +
      `<g class="fb fb${i}"${isDiag ? '' : ' opacity="0"'}>${fam(1)}</g>` +
      '</g></g></g>'
    )
  }).join('')

  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">' +
    `<style>${CSS}${timing(clock, rate)}${scared ? SCATTER : ''}</style>` +
    '<rect x="-400" y="-400" width="2400" height="1800" fill="#000"/>' +
    SPECKS +
    (phase === 'typing' ? SONAR : '') +
    (phase === 'working' && full ? BUBBLES : '') +
    `<g${classes(phase === 'stopped' ? 'dim' : '', scared ? 'scat' : '')}>${sharks}</g>` +
    GRID +
    '</svg>'
  )
}

/** For readers who cannot see the scene. */
/** A class attribute for the names given, or nothing when there are none. */
function classes(...names: string[]): string {
  const list = names.filter(n => n !== '').join(' ')

  return list === '' ? '' : ` class="${list}"`
}

export function sceneAlt(phase: Phase, scared = false): string {
  if (scared) {
    return 'The sharks scatter for a moment'
  }
  switch (phase) {
    case 'working':
      return 'Top-down pixel-block sharks swimming on black'
    case 'done':
      return 'Top-down pixel-block sharks swimming on black'
    case 'stopped':
      return 'The sharks dim for a moment'
    default:
      return 'Top-down pixel-block sharks swimming on black: a great white, hammerheads, a thresher and a whale shark'
  }
}
