import type { Phase, Sea } from '../types'

/**
 * Swim speed per state. The sharks keep one tempo in every state: events in
 * the scene (bubbles, sonar, dimming) tell the state, not speed. The clock
 * stays so that a state that ever changes speed won't make the sharks jump.
 */
export function rateOf(_phase: Phase, _full: boolean): number {
  return 1
}

/** The swim clock at `now` (seconds at speed 1). */
export function swimAt(s: Sea, now: number): number {
  return s.clock + (Math.max(0, now - s.since) / 1000) * s.rate
}

/**
 * Changes the state or speed. Elapsed time is folded into the clock at the old
 * speed first, so the sharks carry on exactly where they were.
 */
export function shift(s: Sea, now: number, phase: Phase, full: boolean): Sea {
  return {
    phase,
    full,
    seq: s.phase === phase ? s.seq : s.seq + 1,
    clock: swimAt(s, now),
    since: now,
    rate: rateOf(phase, full),
  }
}
