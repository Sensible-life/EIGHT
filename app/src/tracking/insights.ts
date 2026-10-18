import type { CueTarget, Level, Segment } from './types';

/** Not explored yet: underused parts, then low / high below `levelMinShare` (only when level was judged at all). */
export function unexploredTargets(underused: Segment[], level: Record<Level, number>, levelMinShare: number): CueTarget[] {
  const judged = level.low + level.mid + level.high > 0;
  return [...underused, ...(judged ? (['low', 'high'] as const).filter(l => level[l] < levelMinShare) : [])];
}