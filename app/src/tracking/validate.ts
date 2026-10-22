import { REACH_DIRS, SPACE_CELLS } from './moves';
import { LEVELS, SEGMENT_NAMES } from './segments';
import type { MoveTotals, SessionTracking } from './types';

const count = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const exact = (o: unknown, keys: readonly string[], ok: (v: number) => boolean): o is Record<string, number> =>
  !!o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length === keys.length &&
  keys.every(k => Object.prototype.hasOwnProperty.call(o, k) && count((o as Record<string, unknown>)[k]) && ok((o as Record<string, number>)[k]));

const SIDE_KEYS = ['l', 'r'] as const;
const bySides = (o: unknown, ok: (v: unknown) => boolean): boolean =>
  !!o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length === 2 && SIDE_KEYS.every(k => Object.prototype.hasOwnProperty.call(o, k) && ok((o as Record<string, unknown>)[k]));
const MOVE_KEYS = ['reach', 'clap', 'circle', 'lift', 'legTravel', 'turnHalves', 'jump', 'low', 'travel', 'lean', 'spaceMs'];

/** Saved move / space counts: the exact shape of MoveTotals, finite counts only. */
export function validMoves(x: unknown): x is MoveTotals {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const m = x as Record<string, unknown>;
  if (Object.keys(m).length !== MOVE_KEYS.length || !MOVE_KEYS.every(k => Object.prototype.hasOwnProperty.call(m, k))) return false;
  const counts = (o: unknown) => exact(o, SIDE_KEYS, () => true);
  return bySides(m.reach, r => exact(r, REACH_DIRS, () => true)) && count(m.clap) && counts(m.circle)
    && bySides(m.lift, l => exact(l, ['small', 'big'], () => true)) && counts(m.legTravel) && count(m.turnHalves)
    && count(m.jump) && count(m.low) && counts(m.travel) && counts(m.lean)
    && Array.isArray(m.spaceMs) && m.spaceMs.length === SPACE_CELLS && m.spaceMs.every(count);
}

/** Saved tracking totals from disk or a backup: known keys only, finite counts, nothing above the frame count. */
export function validTracking(x: unknown): x is SessionTracking {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const s = x as { version?: unknown; trackedMs?: unknown; totals?: unknown; moves?: unknown };
  if (s.version !== 1 || !count(s.trackedMs) || !s.totals || typeof s.totals !== 'object') return false;
  if (s.moves !== undefined && !validMoves(s.moves)) return false;
  const t = s.totals as { frames?: unknown; score?: unknown; observed?: unknown; levels?: unknown };
  if (!count(t.frames)) return false;
  const frames = t.frames as number;
  return exact(t.score, SEGMENT_NAMES, () => true)
    && exact(t.observed, SEGMENT_NAMES, v => v <= frames)
    && exact(t.levels, LEVELS, v => v <= frames)
    && LEVELS.reduce((sum, l) => sum + (t.levels as Record<string, number>)[l], 0) <= frames;
}
