// Which 8count window a frame belongs to. In the app the window follows the song: the server's
// analysis.eights, else a BPM grid, else fixed 4 s steps. `rolling` = id403's "last 4 s" (golden test).
import { DEFAULT_CONFIG, type TrackingConfig } from './config';

export type Eight = { index: number; start: number; end: number }; // seconds, like analysis.eights
export type EightPlan =
  | { kind: 'rolling'; ms: number }
  | { kind: 'eights'; eights: Eight[] }
  | { kind: 'grid'; seconds: number; source: 'tempo' | 'fixed' };

export const INTRO = -1; // before the song's first eight

function eightAt(eights: Eight[], t: number): Eight | null {
  let lo = 0, hi = eights.length - 1, found: Eight | null = null;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (eights[m].start <= t) { found = eights[m]; lo = m + 1; } else hi = m - 1;
  }
  return found;
}

const clampCount = (n: number) => Math.min(8, Math.max(1, n));

/** Key of the 8count window for a song position (null for rolling windows). */
export function eightKey(plan: EightPlan, musicT: number): number | null {
  if (plan.kind === 'rolling') return null;
  if (plan.kind === 'eights') return eightAt(plan.eights, musicT)?.index ?? INTRO;
  return Math.floor(Math.max(0, musicT) / plan.seconds);
}

/** Count 1..8 inside the current eight, or null (intro, rolling). */
export function countInEight(plan: EightPlan, musicT: number): number | null {
  if (plan.kind === 'rolling') return null;
  if (plan.kind === 'eights') {
    const e = eightAt(plan.eights, musicT);
    if (!e || e.end <= e.start) return null;
    return clampCount(Math.floor((musicT - e.start) / ((e.end - e.start) / 8)) + 1);
  }
  return clampCount(Math.floor((Math.max(0, musicT) % plan.seconds) / (plan.seconds / 8)) + 1);
}

/** The song's eights when the server analysed it, else 8 beats at its BPM, else fixed steps. */
export function planFor(
  eights: Eight[] | null | undefined,
  tempo: number | null | undefined,
  fixedSeconds: number,
  bpm: Pick<TrackingConfig['app'], 'min_bpm' | 'max_bpm'> = DEFAULT_CONFIG.app,
): EightPlan {
  if (eights && eights.length) return { kind: 'eights', eights: [...eights].sort((a, b) => a.start - b.start) };
  if (typeof tempo === 'number' && Number.isFinite(tempo) && tempo >= bpm.min_bpm && tempo <= bpm.max_bpm)
    return { kind: 'grid', seconds: (8 * 60) / tempo, source: 'tempo' };
  return { kind: 'grid', seconds: fixedSeconds, source: 'fixed' };
}
