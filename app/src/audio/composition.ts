import type { LoopRange } from './StemPlayer';

/** Detect a natural loop wrap; manual seeks clear the previous position first. */
export function crossedLoop(previous: number | null, current: number, range: LoopRange, expected: { start: number; end: number }): boolean {
  return previous !== null && range !== null && Math.abs(range.start - expected.start) < .01 && Math.abs(range.end - expected.end) < .01 &&
    current < previous - .2 && previous >= expected.end - .4 && current <= expected.start + .4;
}
