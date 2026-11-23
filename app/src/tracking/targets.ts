// What the display's character may point out: the limbs, heights and sides of the space the dancer has been
// leaving out (recent window), and which of them were just tried (8-count window). Parts that were not seen
// enough are never lacking: the tracker's underused list already leaves them out (principle 4).
import type { TrackingConfig } from './config';
import type { Zone } from './labels';
import { SEGMENT_NAMES } from './segments';
import type { Segment, UsageMessage } from './types';

export type Target = 'arm_l' | 'arm_r' | 'leg_l' | 'leg_r' | 'low' | 'high' | 'left' | 'right';
/** Limbs first, then heights, then sides: the order lists come in, and the tie-break for the character. */
export const TARGET_ORDER: Target[] = ['arm_l', 'arm_r', 'leg_l', 'leg_r', 'low', 'high', 'left', 'right'];
const LIMBS: Segment[] = ['arm_l', 'arm_r', 'leg_l', 'leg_r'];
const LEVELS = ['low', 'high'] as const;
const SIDES: Exclude<Zone, 'center'>[] = ['left', 'right'];
const r3 = (x: number) => Math.round(1000 * x) / 1000;
const ordered = (set: Set<Target>) => TARGET_ORDER.filter(t => set.has(t));

/** Arms against legs for the display's two rings; null while tracking is not ok or the limbs did not move. */
export function ringShares(usage: UsageMessage | undefined): { upper: number; lower: number } | null {
  if (!usage?.tracking_ok) return null;
  const s = usage.segments, upper = s.arm_l + s.arm_r, total = upper + s.leg_l + s.leg_r;
  if (!(total > 0)) return null;
  const u = r3(upper / total);
  return { upper: u, lower: r3(1 - u) };
}

/** Limbs the tracker finds underused, heights below level_min_share, sides below zone_min_share (zones null: not yet known). */
export function lackingTargets(recent: UsageMessage | undefined, zones: Record<Zone, number> | null, cfg: TrackingConfig): Target[] {
  if (!recent?.tracking_ok) return [];
  const out = new Set<Target>(), allowed = cfg.feedback.segment_targets.length ? cfg.feedback.segment_targets : LIMBS;
  for (const s of recent.underused) if (LIMBS.includes(s) && allowed.includes(s)) out.add(s as Target);
  const lv = recent.level;
  if (lv.low + lv.mid + lv.high > 0) for (const l of LEVELS) if (lv[l] < cfg.feedback.level_min_share) out.add(l);
  if (zones) for (const z of SIDES) if (zones[z] < cfg.targets.zone_min_share) out.add(z);
  return ordered(out);
}

/** Targets used enough in the 8-count window to count as tried (the feedback engine's "explored" shares). */
export function exploredTargets(eight: UsageMessage | undefined, zones: Record<Zone, number> | null, cfg: TrackingConfig): Target[] {
  if (!eight?.tracking_ok) return [];
  const out = new Set<Target>(), limbShare = cfg.feedback.segment_explored_ratio / SEGMENT_NAMES.length;
  for (const s of LIMBS) if ((eight.segments[s] ?? 0) >= limbShare) out.add(s as Target);
  for (const l of LEVELS) if ((eight.level[l] ?? 0) >= cfg.feedback.level_explored_share) out.add(l);
  if (zones) for (const z of SIDES) if (zones[z] >= cfg.targets.zone_explored_share) out.add(z);
  return ordered(out);
}
