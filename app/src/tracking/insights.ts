import { DEFAULT_CONFIG, shareOptions, type TrackingConfig } from './config';
import { TIE_ORDER } from './feedback';
import { emptyMoves, mergeMoves } from './moves';
import { emptyTotals, mergeTotals, snapshotFromTotals } from './usage';
import type { CueTarget, Level, MoveTotals, Segment, SessionTracking, UsageTotals } from './types';

/** Not explored yet: underused parts, then low / high below `levelMinShare` (only when level was judged at all). */
export function unexploredTargets(underused: Segment[], level: Record<Level, number>, levelMinShare: number): CueTarget[] {
  const judged = level.low + level.mid + level.high > 0;
  return [...underused, ...(judged ? (['low', 'high'] as const).filter(l => level[l] < levelMinShare) : [])];
}

export type Unexplored = { target: CueTarget; count: number };
export type TrackingInsights = { sessions: number; trackedMs: number; segments: Record<Segment, number>; level: Record<Level, number>; unexplored: Unexplored[] };

/**
 * Analysis tab: body use over the sessions tracked at least app.min_tracked_s, and how many of them
 * left each part / level unexplored. Counts of facts only, no score.
 */
export function trackingInsights(saved: (SessionTracking | undefined)[], cfg: TrackingConfig = DEFAULT_CONFIG): TrackingInsights | null {
  const used = saved.filter((s): s is SessionTracking => !!s && s.trackedMs >= 1000 * cfg.app.min_tracked_s);
  if (!used.length) return null;
  const opts = shareOptions(cfg), counts = new Map<CueTarget, number>();
  let sum: UsageTotals = emptyTotals();
  for (const s of used) {
    sum = mergeTotals(sum, s.totals);
    const snap = snapshotFromTotals(s.totals, opts);
    for (const t of unexploredTargets(snap.underused, snap.level, cfg.feedback.level_min_share)) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const all = snapshotFromTotals(sum, opts);
  const unexplored = [...counts]
    .map(([target, count]) => ({ target, count }))
    .sort((a, b) => b.count - a.count || TIE_ORDER.indexOf(a.target) - TIE_ORDER.indexOf(b.target));
  return { sessions: used.length, trackedMs: used.reduce((a, s) => a + s.trackedMs, 0), segments: all.segments, level: all.level, unexplored };
}

export type MoveInsights = { sessions: number; trackedMs: number; moves: MoveTotals };

/** Analysis tab: move and space counts summed over the sessions tracked at least app.min_tracked_s (older saves have none). */
export function moveInsights(saved: (SessionTracking | undefined)[], cfg: TrackingConfig = DEFAULT_CONFIG): MoveInsights | null {
  const used = saved.filter((s): s is SessionTracking & { moves: MoveTotals } => !!s?.moves && s.trackedMs >= 1000 * cfg.app.min_tracked_s);
  if (!used.length) return null;
  return { sessions: used.length, trackedMs: used.reduce((a, s) => a + s.trackedMs, 0), moves: used.reduce((sum, s) => mergeMoves(sum, s.moves), emptyMoves()) };
}