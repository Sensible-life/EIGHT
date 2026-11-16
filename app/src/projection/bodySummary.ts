import type { PoseMessage, UsageMessage } from '../tracking/types';

/** Only aggregated arm/leg shares leave the device. Missing landmarks are not treated as zero use. */
export function bodySummary(usage: UsageMessage | undefined, pose: PoseMessage | null): { upper: number; lower: number; underused: string[] } | null {
  if (!usage?.tracking_ok || !pose || [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28].some(i => !pose.lm[i] || !Number.isFinite(pose.lm[i][2]) || pose.lm[i][2] < 0.6)) return null;
  const keys = ['arm_l', 'arm_r', 'leg_l', 'leg_r'] as const;
  const values = keys.map(key => usage.segments[key]);
  if (values.some(value => !Number.isFinite(value) || value < 0)) return null;
  const upper = values[0] + values[1], lower = values[2] + values[3], total = upper + lower;
  if (total <= 0) return null;
  return { upper: Math.round(upper / total * 1000) / 1000, lower: Math.round(lower / total * 1000) / 1000, underused: usage.underused.filter(value => keys.some(key => key === value)) };
}
