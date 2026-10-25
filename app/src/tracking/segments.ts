// Body segment definitions on the MediaPipe 33-landmark topology (id403 processing/segments.py).
// "left/right" = the dancer's own left / right (MediaPipe convention), not the screen side.
import type { Level, Segment } from './types';

export const NOSE = 0;
export const L_EAR = 7, R_EAR = 8;
export const L_SHOULDER = 11, R_SHOULDER = 12;
export const L_ELBOW = 13, R_ELBOW = 14;
export const L_WRIST = 15, R_WRIST = 16;
export const L_HIP = 23, R_HIP = 24;
export const L_KNEE = 25, R_KNEE = 26;
export const L_ANKLE = 27, R_ANKLE = 28;
export const L_FOOT = 31, R_FOOT = 32; // foot index (toe)

/** Landmarks whose motion counts toward each segment. Disjoint, so shares sum cleanly. */
export const SEGMENTS: Record<Segment, number[]> = {
  head: [NOSE, L_EAR, R_EAR],
  torso: [L_SHOULDER, R_SHOULDER, L_HIP, R_HIP],
  arm_l: [L_ELBOW, L_WRIST],
  arm_r: [R_ELBOW, R_WRIST],
  leg_l: [L_KNEE, L_ANKLE, L_FOOT],
  leg_r: [R_KNEE, R_ANKLE, R_FOOT],
};
export const SEGMENT_NAMES: Segment[] = ['head', 'torso', 'arm_l', 'arm_r', 'leg_l', 'leg_r'];
export const LEVELS: Level[] = ['low', 'mid', 'high'];

/** Joint angles (a, vertex, b) whose angular speed counts toward a segment. Same order as id403. */
export const JOINT_ANGLES: { name: string; ids: [number, number, number]; segment: Segment }[] = [
  { name: 'shoulder_l', ids: [L_HIP, L_SHOULDER, L_ELBOW], segment: 'arm_l' },
  { name: 'shoulder_r', ids: [R_HIP, R_SHOULDER, R_ELBOW], segment: 'arm_r' },
  { name: 'elbow_l', ids: [L_SHOULDER, L_ELBOW, L_WRIST], segment: 'arm_l' },
  { name: 'elbow_r', ids: [R_SHOULDER, R_ELBOW, R_WRIST], segment: 'arm_r' },
  { name: 'hip_l', ids: [L_SHOULDER, L_HIP, L_KNEE], segment: 'leg_l' },
  { name: 'hip_r', ids: [R_SHOULDER, R_HIP, R_KNEE], segment: 'leg_r' },
  { name: 'knee_l', ids: [L_HIP, L_KNEE, L_ANKLE], segment: 'leg_l' },
  { name: 'knee_r', ids: [R_HIP, R_KNEE, R_ANKLE], segment: 'leg_r' },
];

/** Lines of the stick figure drawn over the camera preview. */
export const SKELETON_EDGES: [number, number][] = [
  [L_SHOULDER, R_SHOULDER], [L_SHOULDER, L_ELBOW], [L_ELBOW, L_WRIST], [R_SHOULDER, R_ELBOW],
  [R_ELBOW, R_WRIST], [L_SHOULDER, L_HIP], [R_SHOULDER, R_HIP], [L_HIP, R_HIP], [L_HIP, L_KNEE],
  [L_KNEE, L_ANKLE], [L_ANKLE, L_FOOT], [R_HIP, R_KNEE], [R_KNEE, R_ANKLE], [R_ANKLE, R_FOOT],
];

export const segmentOf = (landmark: number): Segment | null =>
  SEGMENT_NAMES.find(s => SEGMENTS[s].includes(landmark)) ?? null;

export const bySegment = <T>(f: (s: Segment) => T): Record<Segment, T> =>
  Object.fromEntries(SEGMENT_NAMES.map(s => [s, f(s)])) as Record<Segment, T>;

export const byLevel = <T>(f: (l: Level) => T): Record<Level, T> =>
  Object.fromEntries(LEVELS.map(l => [l, f(l)])) as Record<Level, T>;
