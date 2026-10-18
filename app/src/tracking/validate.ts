import { LEVELS, SEGMENT_NAMES } from './segments';
import type { SessionTracking } from './types';

const count = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const exact = (o: unknown, keys: readonly string[], ok: (v: number) => boolean): o is Record<string, number> =>
  !!o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length === keys.length &&
  keys.every(k => Object.prototype.hasOwnProperty.call(o, k) && count((o as Record<string, unknown>)[k]) && ok((o as Record<string, number>)[k]));

/** Saved tracking totals from disk or a backup: known keys only, finite counts, nothing above the frame count. */
export function validTracking(x: unknown): x is SessionTracking {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const s = x as { version?: unknown; trackedMs?: unknown; totals?: unknown };
  if (s.version !== 1 || !count(s.trackedMs) || !s.totals || typeof s.totals !== 'object') return false;
  const t = s.totals as { frames?: unknown; score?: unknown; observed?: unknown; levels?: unknown };
  if (!count(t.frames)) return false;
  const frames = t.frames as number;
  return exact(t.score, SEGMENT_NAMES, () => true)
    && exact(t.observed, SEGMENT_NAMES, v => v <= frames)
    && exact(t.levels, LEVELS, v => v <= frames)
    && LEVELS.reduce((sum, l) => sum + (t.levels as Record<string, number>)[l], 0) <= frames;
}
