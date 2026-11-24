// Scripted figures: a standing dancer moved by small functions of time, read by the real tracking code. Two uses:
// the display's demo (a dancer without a camera, server/app/display.html) and the moves page (what each movement
// word means, server/app/moves.html). The moves are the ones the labeler tests are built on
// (scripts/tracking/labels.test.cjs); scripts/tracking/figures.test.cjs checks that each still reads as its word.
import { OverheadAnswer } from './answer';
import { DEFAULT_CONFIG, type TrackingConfig } from './config';
import { MovementLabeler, type MovementLabel, type PartLabel, type PartName, type SpaceLabel } from './labels';
import { poseFromEvent } from './store';
import type { Target } from './targets';
import type { PoseEvent } from './types';

export type P2 = [number, number];
/** 33 landmarks in image coordinates (0..1) of an upright 3:4 frame; not mirrored, so x grows to the dancer's left. */
export type Figure = P2[];
export const FIGURE_ASPECT = 0.75;
export const BEAT_S = 0.5; // the moves keep time with 120 BPM
const STILL_S = 3; // a reading starts standing still: the calibration

/** Standing, arms down, feet under the hips; the torso is 0.2 of the frame high. */
export function standing(): Figure {
  const P: Figure = Array.from({ length: 33 }, () => [0.5, 0.5] as P2);
  const set = (i: number, x: number, y: number) => { P[i] = [x, y]; };
  set(0, 0.5, 0.2); // nose
  set(1, 0.51, 0.19); set(2, 0.515, 0.19); set(3, 0.52, 0.19); set(4, 0.49, 0.19); set(5, 0.485, 0.19); set(6, 0.48, 0.19); // eyes
  set(7, 0.53, 0.2); set(8, 0.47, 0.2); set(9, 0.51, 0.22); set(10, 0.49, 0.22); // ears, mouth
  set(11, 0.56, 0.3); set(12, 0.44, 0.3); set(13, 0.58, 0.4); set(14, 0.42, 0.4); set(15, 0.59, 0.5); set(16, 0.41, 0.5);
  set(23, 0.53, 0.5); set(24, 0.47, 0.5); set(25, 0.53, 0.65); set(26, 0.47, 0.65); set(27, 0.53, 0.8); set(28, 0.47, 0.8);
  return P;
}

/** Hands follow the forearm, heels and toes follow the ankle, after a move has placed the arms and legs. */
function attach(P: Figure): Figure {
  for (const [elbow, wrist, fingers] of [[13, 15, [17, 19, 21]], [14, 16, [18, 20, 22]]] as const) {
    const d: P2 = [P[wrist][0] - P[elbow][0], P[wrist][1] - P[elbow][1]];
    fingers.forEach((f, k) => { P[f] = [P[wrist][0] + d[0] * (0.25 + 0.05 * k), P[wrist][1] + d[1] * (0.25 + 0.05 * k)]; });
  }
  for (const [ankle, heel, toe, out] of [[27, 29, 31, 1], [28, 30, 32, -1]] as const) {
    P[heel] = [P[ankle][0], P[ankle][1] + 0.012];
    P[toe] = [P[ankle][0] + 0.02 * out, P[ankle][1] + 0.022];
  }
  return P;
}

const moveAll = (P: Figure, dx: number, dy: number, only: (i: number) => boolean = () => true) =>
  P.forEach((p, i) => { if (only(i)) { p[0] += dx; p[1] += dy; } });
const UPPER = (i: number) => i < 25; // everything but the knees and the feet
const beat = (t: number) => (t / BEAT_S) % 1;
const punch = (k: number) => (k < 0.15 ? k / 0.15 : k < 0.4 ? 1 : 1 - (k - 0.4) / 0.6); // out fast, back slowly
type Pose = (t: number, P: Figure) => void;

// Arms and legs. Each takes the time since the move began and moves the standing figure.
const reachRight: Pose = (t, P) => { const out = punch(beat(t)); P[16] = [0.42 - 0.22 * out, 0.33]; P[14] = [0.43 - 0.1 * out, 0.36 - 0.03 * out]; };
const circleLeft: Pose = (t, P) => { const a = Math.PI * t; P[15] = [0.56 + 0.2 * Math.cos(a), 0.3 + 0.2 * Math.sin(a)]; P[13] = [0.56 + 0.1 * Math.cos(a), 0.3 + 0.1 * Math.sin(a)]; };
const circleRight: Pose = (t, P) => { const a = Math.PI - Math.PI * t; P[16] = [0.44 + 0.2 * Math.cos(a), 0.3 + 0.2 * Math.sin(a)]; P[14] = [0.44 + 0.1 * Math.cos(a), 0.3 + 0.1 * Math.sin(a)]; };
const swingLeft: Pose = (t, P) => { const a = Math.PI / 2 + 0.6 * Math.sin(Math.PI * t); P[15] = [0.56 + 0.2 * Math.cos(a), 0.3 + 0.2 * Math.sin(a)]; P[13] = [0.56 + 0.1 * Math.cos(a), 0.3 + 0.1 * Math.sin(a)]; };
const forearmLeft: Pose = (t, P) => { const a = Math.PI * t; P[13] = [0.66, 0.3]; P[15] = [0.66 + 0.1 * Math.cos(a), 0.3 + 0.1 * Math.sin(a)]; }; // upper arm out, the forearm turns around the elbow
const march: Pose = (t, P) => { // the feet take turns rising a little, on the beat
  for (const [ankle, knee, phase] of [[27, 25, 0], [28, 26, Math.PI]] as const) { const up = Math.max(0, Math.sin(Math.PI * t / BEAT_S + phase)); P[ankle][1] -= 0.04 * up; P[knee][1] -= 0.02 * up; }
};
// a hand shaken fast, about as wide as a real one (a much smaller shake is lost in camera jitter)
const shakeRight: Pose = (t, P) => { const a = 2 * Math.PI * 6 * t; P[16] = [0.41 + 0.03 * Math.sin(a), 0.5 + 0.02 * Math.cos(a)]; };
const kneeLeft: Pose = (t, P) => { const up = punch(beat(t)); P[25] = [0.56, 0.65 - 0.12 * up]; P[27] = [0.55, 0.8 - 0.14 * up]; }; // knee up on the beat
const kick = (side: 1 | -1): Pose => (t, P) => { // out to the dancer's side and back, on the beat
  const out = Math.abs(Math.sin(Math.PI * t / BEAT_S / 2)), [hip, knee, ankle] = side > 0 ? [23, 25, 27] : [24, 26, 28];
  P[ankle] = [P[hip][0] + side * 0.2 * out, 0.8 - 0.12 * out]; P[knee] = [P[hip][0] + side * 0.1 * out, 0.65 - 0.03 * out];
};
// The torso: hips against the feet, the whole body against the spot where it stood.
const shift: Pose = (t, P) => moveAll(P, 0.08 * Math.sin(Math.PI * t / 2), 0, UPPER);
const travel: Pose = (t, P) => moveAll(P, 0.12 * Math.sin(Math.PI * t / 2), 0);
const jump: Pose = (t, P) => moveAll(P, 0, -0.12 * Math.abs(Math.sin(Math.PI * t / BEAT_S)));
const crouch = (depth: number, P: Figure) => { // hips and everything above come down, the knees bend out
  moveAll(P, 0, depth, UPPER);
  P[25] = [P[25][0] + 0.4 * depth, P[25][1] + 0.5 * depth]; P[26] = [P[26][0] - 0.4 * depth, P[26][1] + 0.5 * depth];
};
const ease = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, x)));
const drop: Pose = (t, P) => crouch(0.12 * (t < 4 ? ease(t / 2) : 1 - ease((t - 4) / 2)), P); // down in 2 s, stay, up from 4 s
const reachLeft: Pose = (t, P) => { const out = punch(beat(t)); P[15] = [0.58 + 0.22 * out, 0.33]; P[13] = [0.57 + 0.1 * out, 0.36 - 0.03 * out]; };
const toSide = (side: 1 | -1): Pose => (t, P) => { // walk to one side in 2 s, dance there (reaching back towards the middle), walk back from 6 s
  const x = t < 2 ? t / 2 : t < 6 ? 1 : Math.max(0, 1 - (t - 6) / 2), [wrist, elbow] = side > 0 ? [16, 14] : [15, 13];
  moveAll(P, side * 0.3 * x, 0); (side > 0 ? reachRight : reachLeft)(t, P); P[wrist][0] += side * 0.3 * x; P[elbow][0] += side * 0.3 * x;
};
const overheadO: Pose = (_t, P) => { P[15] = [0.51, 0.08]; P[16] = [0.49, 0.08]; P[13] = [0.62, 0.18]; P[14] = [0.38, 0.18]; };
const both = (...poses: Pose[]): Pose => (t, P) => poses.forEach(p => p(t, P));

export type Move = {
  id: string;
  part: PartName | 'space' | 'answer'; // what the reading is about
  kind: string; // the word it reads as (a part's kind, the space zone, or 'yes')
  joints: number[]; // the moving part, drawn brighter
  trail: number; // the joint whose path is drawn
  loopS: number; // the animation repeats after this long
  readS?: number; // read the move this long after it began (default 8 s)
  pose: Pose;
};
const ARM_L = [11, 13, 15, 17, 19, 21], ARM_R = [12, 14, 16, 18, 20, 22], LEG_L = [23, 25, 27, 29, 31], LEG_R = [24, 26, 28, 30, 32];
const TORSO = [11, 12, 23, 24];

/** The words, one scripted figure each (the moves page plays them; figures.test checks they read as their word). */
export const MOVES: Move[] = [
  { id: 'hold', part: 'arm_l', kind: 'hold', joints: ARM_L, trail: 15, loopS: 2, pose: () => {} },
  { id: 'reach', part: 'arm_r', kind: 'reach', joints: ARM_R, trail: 16, loopS: 2, pose: reachRight },
  { id: 'circle', part: 'arm_l', kind: 'circle', joints: ARM_L, trail: 15, loopS: 2, pose: circleLeft },
  { id: 'forearm', part: 'arm_l', kind: 'circle', joints: ARM_L, trail: 15, loopS: 2, pose: forearmLeft },
  { id: 'swing', part: 'arm_l', kind: 'swing', joints: ARM_L, trail: 15, loopS: 2, pose: swingLeft },
  { id: 'shake', part: 'arm_r', kind: 'shake', joints: ARM_R, trail: 16, loopS: 2, pose: shakeRight },
  { id: 'march', part: 'leg_l', kind: 'step', joints: [...LEG_L, ...LEG_R], trail: 27, loopS: 1, pose: march },
  { id: 'knee', part: 'leg_l', kind: 'reach', joints: LEG_L, trail: 27, loopS: 2, pose: kneeLeft },
  { id: 'kick', part: 'leg_r', kind: 'swing', joints: LEG_R, trail: 28, loopS: 2, pose: kick(-1) },
  { id: 'shift', part: 'torso', kind: 'shift', joints: TORSO, trail: 23, loopS: 4, pose: shift },
  { id: 'travel', part: 'torso', kind: 'travel', joints: TORSO, trail: 23, loopS: 4, pose: travel },
  { id: 'jump', part: 'torso', kind: 'jump', joints: TORSO, trail: 23, loopS: 1, pose: jump },
  { id: 'drop', part: 'torso', kind: 'drop', joints: TORSO, trail: 23, loopS: 6, readS: 3, pose: drop },
  { id: 'left', part: 'space', kind: 'left', joints: TORSO, trail: 23, loopS: 8, readS: 5, pose: toSide(1) },
  { id: 'right', part: 'space', kind: 'right', joints: TORSO, trail: 24, loopS: 8, readS: 5, pose: toSide(-1) },
  { id: 'yes', part: 'answer', kind: 'yes', joints: [...ARM_L, ...ARM_R], trail: 15, loopS: 4, pose: overheadO },
];

const figure = (pose: Pose | null, t: number): Figure => { const P = standing(); pose?.(t, P); return attach(P); };
/** The figure `t` seconds into a move (looping), hands and feet attached. */
export const moveFigure = (move: Move, t: number): Figure => figure(move.pose, ((t % move.loopS) + move.loopS) % move.loopS);

/** A pose-camera event for a figure, as webPoseEvent makes one from the browser camera (metric 3D roughly from 2D). */
export function figureEvent(tMs: number, seq: number, P: Figure): PoseEvent {
  const hip: P2 = [(P[23][0] + P[24][0]) / 2, (P[23][1] + P[24][1]) / 2];
  return {
    tMs, seq, ageMs: 0, emitWallMs: tMs, latencyMs: 0, captureFrom: 'analyzer', aspect: FIGURE_ASPECT,
    image: P.flatMap(p => [p[0], p[1], 1]), world: P.flatMap(p => [(p[0] - hip[0]) * 2, (p[1] - hip[1]) * 2, 0]),
  };
}

export type MoveReading = { label: MovementLabel | null; part: PartLabel | null; space: SpaceLabel | null; yesAfterS: number | null };
/** What the real labeler (and the O answer) make of a move: 3 s still, then the move, read `readS` seconds in. */
export function readMove(move: Move, cfg: TrackingConfig = DEFAULT_CONFIG): MoveReading {
  const labeler = new MovementLabeler(cfg.labels), answer = new OverheadAnswer(cfg.answer), fps = 30;
  let yesAfterS: number | null = null;
  for (let i = 0; i < (STILL_S + (move.readS ?? 8)) * fps; i++) {
    const t = i / fps, P = figure(t >= STILL_S ? move.pose : null, t - STILL_S);
    labeler.add({ tMs: 1000 * t, image: P, visibility: P.map(() => 1), aspect: FIGURE_ASPECT, musicT: t, beatS: BEAT_S });
    const pose = poseFromEvent(figureEvent(1000 * t, i, P));
    if (answer.update(pose, FIGURE_ASPECT, true, 1000 * t).yes && yesAfterS === null) yesAfterS = Math.round(10 * (t - STILL_S)) / 10;
  }
  const label = labeler.label();
  return { label, part: label && move.part !== 'space' && move.part !== 'answer' ? label.parts[move.part] : null, space: label?.space ?? null, yesAfterS };
}

// ---- the demo's dancer: dances with the arms only, answers the character, then tries what it suggested ----
export type DemoCue = 'still' | 'dance' | 'yes' | Target;
/** How long the demo dancer tries a suggestion before dancing with the arms again. */
export const DEMO_TRY_S = 14;
const TARGET_POSE: Record<Target, Pose> = {
  arm_l: both(circleLeft), arm_r: both(circleRight),
  leg_l: both(kick(1), swingLeft), leg_r: both(kick(-1), swingLeft),
  low: (t, P) => { reachRight(t, P); crouch(0.12 * (t < DEMO_TRY_S - 2 ? ease(t) : 1 - ease((t - DEMO_TRY_S + 2) / 2)), P); }, // down, then up before the end
  high: both(reachRight, jump), left: toSide(1), right: toSide(-1),
};
const DANCE: Pose = both(reachRight, circleLeft);
/** The demo dancer `t` seconds into the current cue: still (calibration), dancing with the arms, an O, or a target. */
export const demoFigure = (cue: DemoCue, t: number): Figure =>
  figure(cue === 'still' ? null : cue === 'dance' ? DANCE : cue === 'yes' ? overheadO : TARGET_POSE[cue], t);
