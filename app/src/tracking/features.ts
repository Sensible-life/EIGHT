// Feature extraction: normalization, joint angles, segment activity, body level (id403 features.py).
import type { LevelThresholds } from './config';
import { EPS, dot, mean, midpoint, norm, sub } from './math';
import {
  JOINT_ANGLES, L_ANKLE, L_HIP, L_SHOULDER, L_WRIST, NOSE, R_ANKLE, R_HIP, R_SHOULDER, R_WRIST,
  SEGMENTS, SEGMENT_NAMES, bySegment,
} from './segments';
import type { Landmarks, Level, PoseFrame, Segment, Vec3 } from './types';

export const visibleMask = (pose: PoseFrame, threshold: number): boolean[] => pose.visibility.map(v => v >= threshold);

export const hipCenter = (lm: Landmarks): Vec3 => midpoint(lm[L_HIP], lm[R_HIP]);
export const shoulderCenter = (lm: Landmarks): Vec3 => midpoint(lm[L_SHOULDER], lm[R_SHOULDER]);
export const torsoLength = (lm: Landmarks): number => norm(sub(shoulderCenter(lm), hipCenter(lm)));

/** Hip-centered, scaled by torso length: removes distance, body size and travel, so only body-relative motion stays. */
export function normalize(lm: Landmarks): Landmarks {
  const scale = Math.max(torsoLength(lm), EPS), hip = hipCenter(lm);
  return lm.map(p => [(p[0] - hip[0]) / scale, (p[1] - hip[1]) / scale, (p[2] - hip[2]) / scale]);
}

/** Angle (radians, 0..pi) at `vertex` between rays to a and b. */
export function angleAt(a: Vec3, vertex: Vec3, b: Vec3): number {
  const v1 = sub(a, vertex), v2 = sub(b, vertex);
  const cos = dot(v1, v2) / Math.max(norm(v1) * norm(v2), EPS);
  return Math.acos(Math.min(1, Math.max(-1, cos)));
}

export const jointAngles = (lm: Landmarks): Record<string, number> =>
  Object.fromEntries(JOINT_ANGLES.map(j => [j.name, angleAt(lm[j.ids[0]], lm[j.ids[1]], lm[j.ids[2]])]));

export type Weights = { speed?: number; angle?: number };

/**
 * Per-segment activity for one frame step. `visible` = landmarks reliable in both frames.
 * score = w_speed * mean landmark speed + w_angle * mean joint angular speed - noise floor, clamped at 0.
 * observed[seg] is false when none of its landmarks are visible (occluded != unused, principle 4).
 */
export function segmentActivity(
  prevNorm: Landmarks, currNorm: Landmarks, prevAngles: Record<string, number>, currAngles: Record<string, number>,
  dtS: number, visible: boolean[], weights: Weights, noiseFloor?: Partial<Record<Segment, number>> | null,
): { scores: Record<Segment, number>; observed: Record<Segment, boolean> } {
  const wSpeed = weights.speed ?? 1.0, wAngle = weights.angle ?? 0.0;
  const speed = currNorm.map((p, i) => norm(sub(p, prevNorm[i])) / dtS);
  const angSpeed = bySegment<number[]>(() => []);
  for (const { name, ids, segment } of JOINT_ANGLES)
    if (name in prevAngles && name in currAngles && ids.every(i => visible[i]))
      angSpeed[segment].push(Math.abs(currAngles[name] - prevAngles[name]) / dtS);
  const useFloor = !!noiseFloor && Object.keys(noiseFloor).length > 0;
  const scores = bySegment(() => 0), observed = bySegment(() => false);
  for (const seg of SEGMENT_NAMES) {
    const vis = SEGMENTS[seg].filter(i => visible[i]);
    observed[seg] = vis.length > 0;
    if (!vis.length) continue;
    let score = wSpeed * mean(vis.map(i => speed[i]));
    if (angSpeed[seg].length) score += wAngle * mean(angSpeed[seg]);
    if (useFloor) score -= noiseFloor?.[seg] ?? 0;
    scores[seg] = Math.max(score, 0);
  }
  return { scores, observed };
}

/** Standing reference from calibration (image coords, y down). */
export type LevelRef = { legRatio: number; hipY: number; torsoImg: number };

/** [hipY, (ankleY - hipY) / torso, torso] in image coords, or null if not visible. */
export function legGeometry(image: Landmarks, visible: boolean[]): [number, number, number] | null {
  if (![L_HIP, R_HIP, L_SHOULDER, R_SHOULDER].every(i => visible[i])) return null;
  const ankles = [L_ANKLE, R_ANKLE].filter(i => visible[i]);
  if (!ankles.length) return null;
  const xy = image.map(p => [p[0], p[1], 0] as Vec3);
  const torso = torsoLength(xy);
  if (torso < EPS) return null;
  const hipY = hipCenter(xy)[1];
  return [hipY, (mean(ankles.map(i => xy[i][1])) - hipY) / torso, torso];
}

/**
 * Body level, null if it can't be judged. ratio = leg extent now / standing leg extent. In order:
 * hip risen > jump_rise * torso -> high; ratio < low -> low; wrist above nose by arms_up_margin * torso
 * or ratio > high (tiptoe) -> high; otherwise mid.
 */
export function level(image: Landmarks, visible: boolean[], ref: LevelRef | null, th: LevelThresholds): Level | null {
  const geo = legGeometry(image, visible);
  if (!ref || ref.legRatio < EPS || !geo) return null;
  const [hipY, legRatio, torso] = geo, ratio = legRatio / ref.legRatio;
  if (hipY < ref.hipY - th.jump_rise * ref.torsoImg) return 'high';
  if (ratio < th.low) return 'low';
  if (visible[NOSE]) {
    const wrists = [L_WRIST, R_WRIST].filter(i => visible[i]);
    const top = image[NOSE][1] - th.arms_up_margin * torso;
    if (wrists.length && Math.min(...wrists.map(i => image[i][1])) < top) return 'high';
  }
  if (ratio > th.high) return 'high';
  return 'mid';
}
