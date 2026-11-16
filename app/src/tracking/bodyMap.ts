// Body heatmap for the analysis tab: segment shares -> fill strength and whole-number percentages.
// Pure logic (no React) so it runs in the node tests like the rest of src/tracking.
import { SEGMENT_NAMES, bySegment } from './segments';
import type { Segment } from './types';

/** null = this part was not measured by the source (e.g. the head in the motion studio's 5-joint traces). */
export type BodyShares = Record<Segment, number | null>;

/** A part carrying this share (a third; an even split over six parts is 1/6) draws at full strength. Same as SkeletonOverlay. */
export const FULL_STRENGTH_SHARE = 1 / 3;
const MIN_FILL = 0.1;
const MAX_FILL = 0.9;

/** Fill opacity for one part: faint when unused, strong at FULL_STRENGTH_SHARE and above. */
export function heatStrength(share: number | null): number {
  if (share === null || !Number.isFinite(share) || share <= 0) return MIN_FILL;
  return MIN_FILL + (MAX_FILL - MIN_FILL) * Math.min(1, share / FULL_STRENGTH_SHARE);
}

/**
 * Whole-number percentages that add up to exactly 100 (largest remainder), so the figure never reads 99% or 101%.
 * Unmeasured parts stay null; all zeros stay zeros.
 */
export function wholePercents(shares: BodyShares): Record<Segment, number | null> {
  const measured = SEGMENT_NAMES.filter(s => shares[s] !== null && Number.isFinite(shares[s] as number) && (shares[s] as number) > 0);
  const total = measured.reduce((sum, s) => sum + (shares[s] as number), 0);
  const out = bySegment<number | null>(s => (shares[s] === null ? null : 0));
  if (total <= 0) return out;
  const raw = measured.map(s => ({ s, v: (100 * (shares[s] as number)) / total }));
  for (const { s, v } of raw) out[s] = Math.floor(v);
  let left = 100 - raw.reduce((sum, { v }) => sum + Math.floor(v), 0);
  const order = [...raw].sort((a, b) => (b.v - Math.floor(b.v)) - (a.v - Math.floor(a.v)) || SEGMENT_NAMES.indexOf(a.s) - SEGMENT_NAMES.indexOf(b.s));
  for (const { s } of order) {
    if (left <= 0) break;
    out[s] = (out[s] as number) + 1;
    left--;
  }
  return out;
}

/** The most and least used measured parts (null when nothing moved). Ties: SEGMENT_NAMES order. */
export function extremes(shares: BodyShares): { most: Segment; least: Segment } | null {
  const measured = SEGMENT_NAMES.filter(s => shares[s] !== null && Number.isFinite(shares[s] as number));
  if (!measured.length || measured.every(s => (shares[s] as number) <= 0)) return null;
  const most = measured.reduce((a, b) => ((shares[b] as number) > (shares[a] as number) ? b : a));
  const least = measured.reduce((a, b) => ((shares[b] as number) < (shares[a] as number) ? b : a));
  return { most, least };
}

/** Camera tracking shares (all six parts measured). */
export const fromSegments = (segments: Record<Segment, number>): BodyShares => bySegment(s => segments[s]);

/** The motion studio's 5-joint result: wrists -> arms, ankles -> legs, hip -> torso; the head is not measured there. */
export function fromStudio(body: { leftWrist: number; rightWrist: number; leftAnkle: number; rightAnkle: number; hip: number }): BodyShares {
  return { head: null, torso: body.hip, arm_l: body.leftWrist, arm_r: body.rightWrist, leg_l: body.leftAnkle, leg_r: body.rightAnkle };
}

/** Live view without a song: the camera clock stands in for the music, always "playing", so every tracked frame counts. */
export function liveClock(startMs: number, nowMs: () => number = () => Date.now()): () => { position: number; playing: boolean } {
  return () => ({ position: Math.max(0, nowMs() - startMs) / 1000, playing: true });
}
