// Demo input: scripted stick figures that stand in for the camera, to try the app without one (browser only).
// A clip follows the song: the figure stands still while the music is paused (so [춤 시작] can calibrate on it)
// and moves on the beat while it plays. The shapes are the ones the move tests use (scripts/tracking/helpers.cjs).
// Figures are built in "square" units (x * aspect, y) and sent as an upright 4:3 frame.
import {
  L_ANKLE, L_EAR, L_ELBOW, L_FOOT, L_HIP, L_KNEE, L_SHOULDER, L_WRIST, NOSE,
  R_ANKLE, R_EAR, R_ELBOW, R_FOOT, R_HIP, R_KNEE, R_SHOULDER, R_WRIST,
} from './segments';
import { NUM_LANDMARKS } from './types';
import type { WebLandmark } from './webEvent';

export const DEMO_ASPECT = 0.75;
const T = 0.15; // torso length in frame heights
const HX = 0.375, HY = 0.55;
type P2 = [number, number];
type Side = 'l' | 'r';

function stand(hx = HX, hy = HY): P2[] {
  const P: P2[] = Array.from({ length: NUM_LANDMARKS }, () => [hx, hy]);
  P[NOSE] = [hx, hy - 1.5 * T];
  P[L_EAR] = [hx + 0.02, hy - 1.5 * T];
  P[R_EAR] = [hx - 0.02, hy - 1.5 * T];
  P[L_SHOULDER] = [hx + 0.4 * T, hy - T];
  P[R_SHOULDER] = [hx - 0.4 * T, hy - T];
  P[L_HIP] = [hx + 0.25 * T, hy];
  P[R_HIP] = [hx - 0.25 * T, hy];
  P[L_ELBOW] = [hx + 0.45 * T, hy - 0.5 * T];
  P[R_ELBOW] = [hx - 0.45 * T, hy - 0.5 * T];
  P[L_WRIST] = [hx + 0.47 * T, hy - 0.05 * T];
  P[R_WRIST] = [hx - 0.47 * T, hy - 0.05 * T];
  P[L_KNEE] = [hx + 0.25 * T, hy + T];
  P[R_KNEE] = [hx - 0.25 * T, hy + T];
  for (const [i, x] of [[L_ANKLE, 0.25], [L_FOOT, 0.25], [R_ANKLE, -0.25], [R_FOOT, -0.25]] as const) P[i] = [hx + x * T, hy + 2 * T];
  return P;
}

/** Arm straight from the shoulder, `deg` from hanging down (180 = straight up). */
function arm(P: P2[], side: Side, deg: number): P2[] {
  const [a, e, w] = side === 'l' ? [L_SHOULDER, L_ELBOW, L_WRIST] : [R_SHOULDER, R_ELBOW, R_WRIST];
  const sx = side === 'l' ? 1 : -1, r = (deg * Math.PI) / 180, len = 0.95 * T, v: P2 = [sx * Math.sin(r), Math.cos(r)];
  P[e] = [P[a][0] + (v[0] * len) / 2, P[a][1] + (v[1] * len) / 2];
  P[w] = [P[a][0] + v[0] * len, P[a][1] + v[1] * len];
  return P;
}

const UPPER = [NOSE, L_EAR, R_EAR, L_SHOULDER, R_SHOULDER, L_ELBOW, R_ELBOW, L_WRIST, R_WRIST, L_HIP, R_HIP];

// Each move takes the seconds since its 8-count began (0 .. 8 beats) and the beat length.
/** Left arm up for the first half of the eight, right arm out to the side for the second. */
function reach(s: number, beat: number): P2[] {
  const half = 4 * beat, hold = 3 * beat;
  if (s < hold) return arm(stand(), 'l', Math.min(175, 10 + s * 300));
  if (s >= half && s < half + hold) return arm(stand(), 'r', Math.min(90, 10 + (s - half) * 200));
  return stand();
}
/** A jump on every other beat. */
function jump(s: number, beat: number): P2[] {
  const local = s % (2 * beat);
  return stand(HX, HY - 0.4 * T * Math.max(0, Math.sin(Math.min(local, 0.5) * 2 * Math.PI)));
}
/** Down toward the floor and back up, once an eight. */
function low(s: number): P2[] {
  const P = stand(), k = 0.6 * T * Math.sin((Math.min(s, 1.5) / 1.5) * Math.PI);
  for (const i of UPPER) P[i] = [P[i][0], P[i][1] + k];
  return P;
}
/** A step out to one side, back through the middle, and out to the other. */
const step = (s: number, beat: number): P2[] => stand(HX + 1.2 * T * Math.sin((2 * Math.PI * s) / (8 * beat)), HY);
/** One full spin at the start of the eight (the shoulders narrow twice). */
function spin(s: number): P2[] {
  const P = stand(), half = 0.4 * T * Math.cos(2 * Math.PI * Math.min(s / 1.2, 1));
  P[L_SHOULDER] = [HX + half, HY - T];
  P[R_SHOULDER] = [HX - half, HY - T];
  return P;
}
/** The right arm circling all the time. */
const circle = (t: number): P2[] => arm(stand(), 'r', (t * 360 * 0.8) % 360);

type Clip = { id: string; label: string; pose: (t: number, beat: number) => P2[] };
const inEight = (t: number, beat: number) => ((t % (8 * beat)) + 8 * beat) % (8 * beat);
const COMBO = [reach, jump, (s: number) => low(s), step];

/** The clips, in the order the buttons show them. */
export const DEMO_CLIPS: Clip[] = [
  { id: 'still', label: '서 있기', pose: () => stand() },
  { id: 'reach', label: '팔 뻗기', pose: (t, b) => reach(inEight(t, b), b) },
  { id: 'circle', label: '팔 돌리기', pose: t => circle(t) },
  { id: 'jump', label: '점프', pose: (t, b) => jump(inEight(t, b), b) },
  { id: 'low', label: '앉기', pose: (t, b) => low(inEight(t, b)) },
  { id: 'step', label: '좌우 스텝', pose: (t, b) => step(inEight(t, b), b) },
  { id: 'spin', label: '회전', pose: (t, b) => spin(inEight(t, b)) },
  { id: 'combo', label: '조합 안무', pose: (t, b) => COMBO[Math.floor(Math.max(0, t) / (8 * b)) % COMBO.length](inEight(t, b), b) },
];

export type DemoFrame = { image: WebLandmark[]; world: WebLandmark[] };

/**
 * One frame of a clip at a song position, as the browser pose model would report it (33 landmarks).
 * beatS = seconds per beat. Paused, or an unknown clip: the standing figure.
 */
export function demoFrame(clipId: string, musicT: number, playing: boolean, beatS: number): DemoFrame {
  const clip = DEMO_CLIPS.find(c => c.id === clipId);
  const beat = beatS > 0 && Number.isFinite(beatS) ? beatS : 0.5;
  const P = clip && playing ? clip.pose(Math.max(0, musicT), beat) : stand();
  const image = P.map(([x, y]) => ({ x: x / DEMO_ASPECT, y, z: 0, visibility: 1 }));
  const hip = { x: (image[L_HIP].x + image[R_HIP].x) / 2, y: (image[L_HIP].y + image[R_HIP].y) / 2 };
  // a rough metric world like the tests use: hip-centered, about 1.6 m tall
  const world = image.map(p => ({ x: (p.x - hip.x) * 2, y: (p.y - hip.y) * 2, z: 0, visibility: 1 }));
  return { image, world };
}
