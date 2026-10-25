// Move detection for the analysis tab (nothing is shown while dancing):
//   moves  — arm reaches (up / side / down), hands together, arm circles, leg lifts, how much the legs travelled, turns
//   space  — jumps, going low, side steps, leans, and time in a 3 x 3 grid (height x the dancer's left / center / right)
// Heuristics on 2D image landmarks scaled by torso length, first tuned on a laptop-webcam run. Thresholds: config `moves`.
// Left / right = the dancer's own. In the raw (not mirrored) image a dancer facing the camera has their left at larger x.
// Counts only: no landmarks are kept (principle 3), and no move is "right" or scored (principle 1).
import type { TrackingConfig } from './config';
import { median } from './math';
import {
  L_ANKLE, L_ELBOW, L_HIP, L_SHOULDER, L_WRIST, NOSE, R_ANKLE, R_ELBOW, R_HIP, R_SHOULDER, R_WRIST,
} from './segments';
import type { MoveTotals, PoseFrame, ReachDir, Side, TrackerState } from './types';

export const SIDES: Side[] = ['l', 'r'];
export const REACH_DIRS: ReachDir[] = ['up', 'side', 'down'];
/** Space cells, row-major: rows high / mid / low, columns the dancer's left / center / right. */
export const SPACE_CELLS = 9;

const bySide = <T>(f: () => T): Record<Side, T> => ({ l: f(), r: f() });

export const emptyMoves = (): MoveTotals => ({
  reach: bySide(() => ({ up: 0, side: 0, down: 0 })),
  clap: 0,
  circle: bySide(() => 0),
  lift: bySide(() => ({ small: 0, big: 0 })),
  legTravel: bySide(() => 0),
  turnHalves: 0,
  jump: 0,
  low: 0,
  travel: bySide(() => 0),
  lean: bySide(() => 0),
  spaceMs: Array(SPACE_CELLS).fill(0),
});

export const mergeMoves = (a: MoveTotals, b: MoveTotals): MoveTotals => {
  const side = (f: (s: Side) => number) => ({ l: f('l'), r: f('r') });
  return {
    reach: { l: { up: a.reach.l.up + b.reach.l.up, side: a.reach.l.side + b.reach.l.side, down: a.reach.l.down + b.reach.l.down },
      r: { up: a.reach.r.up + b.reach.r.up, side: a.reach.r.side + b.reach.r.side, down: a.reach.r.down + b.reach.r.down } },
    clap: a.clap + b.clap,
    circle: side(s => a.circle[s] + b.circle[s]),
    lift: { l: { small: a.lift.l.small + b.lift.l.small, big: a.lift.l.big + b.lift.l.big },
      r: { small: a.lift.r.small + b.lift.r.small, big: a.lift.r.big + b.lift.r.big } },
    legTravel: side(s => a.legTravel[s] + b.legTravel[s]),
    turnHalves: a.turnHalves + b.turnHalves,
    jump: a.jump + b.jump,
    low: a.low + b.low,
    travel: side(s => a.travel[s] + b.travel[s]),
    lean: side(s => a.lean[s] + b.lean[s]),
    spaceMs: a.spaceMs.map((v, i) => v + b.spaceMs[i]),
  };
};

type P2 = [number, number];
const dist = (a: P2, b: P2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const mid = (a: P2, b: P2): P2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const deg = (rad: number) => (rad * 180) / Math.PI;

const ARM: Record<Side, [number, number, number]> = { l: [L_SHOULDER, L_ELBOW, L_WRIST], r: [R_SHOULDER, R_ELBOW, R_WRIST] };
const ANKLE: Record<Side, number> = { l: L_ANKLE, r: R_ANKLE };
const OTHER: Record<Side, Side> = { l: 'r', r: 'l' };

type Base = { torso: number; shoulders: number; hipX: number; hipY: number; leg: number | null };
type ReachEpisode = { start: number; maxDeg: number; off: number | null; done: boolean };
type Facing = 'front' | 'side' | 'back';

export class MoveDetector {
  private saved = emptyMoves(); // restored from a saved session
  private totals = emptyMoves();
  /** Moves were counted or restored: sessions saved before move detection have none, which is not "no moves". */
  measured = false;
  private base: Base | null = null;
  private samples: Base[] = [];
  private smooth: P2[] | null = null;
  private lastT: number | null = null;
  private reachEp: Record<Side, ReachEpisode | null> = bySide(() => null);
  private pending: { t: number; side: Side; dir: ReachDir }[] = [];
  private circleSteps: Record<Side, { t: number; d: number }[]> = bySide(() => []);
  private circlePrev: Record<Side, number | null> = bySide(() => null);
  private circleAt: Record<Side, number> = bySide(() => -Infinity);
  private clapOn = false;
  private clapAt = -Infinity;
  private liftPeak: Record<Side, number | null> = bySide(() => null);
  private prevAnkle: Record<Side, P2 | null> = bySide(() => null);
  private facing: Facing = 'front';
  private facingHist: Facing[] = ['front'];
  private candidate: Facing | null = null;
  private candidateN = 0;
  private lastDip = -Infinity;
  private jumpOn = false;
  private lowOn = false;
  private col = 1;
  private leanOn: Side | null = null;
  private readonly c: TrackingConfig['moves'];
  private readonly visTh: number;

  constructor(cfg: TrackingConfig) {
    this.c = cfg.moves;
    this.visTh = cfg.pose.visibility_threshold;
  }

  /** New session: forget everything, including imported totals. */
  reset(): void {
    this.saved = emptyMoves();
    this.totals = emptyMoves();
    this.measured = false;
    this.recalibrate();
  }

  /** The standing reference is measured again with the tracker's next calibration; totals stay. */
  recalibrate(): void {
    this.base = null;
    this.samples = [];
    this.facing = 'front';
    this.facingHist = ['front'];
    this.candidate = null;
    this.lastDip = -Infinity;
    this.jumpOn = this.lowOn = false;
    this.col = 1;
    this.leanOn = null;
    this.forget();
  }

  exportTotals(): MoveTotals {
    return mergeMoves(this.saved, this.totals);
  }

  importTotals(t: MoveTotals): void {
    this.saved = mergeMoves(emptyMoves(), t);
    this.measured = true;
  }

  /**
   * One frame. `phase` is the body tracker's state: the reference is collected while it calibrates.
   * Moves count only while `counting` (tracking and the music playing), like the usage windows.
   */
  update(tMs: number, pose: PoseFrame | null, aspect: number | null, phase: TrackerState, counting: boolean): void {
    if (!pose) return this.forget();
    const a = aspect && aspect > 0 ? aspect : 1, w = this.c.smoothing;
    const raw = pose.image.map(p => [p[0] * a, p[1]] as P2);
    const prev = this.smooth;
    const P = (this.smooth = prev ? raw.map((p, i): P2 => [w * p[0] + (1 - w) * prev[i][0], w * p[1] + (1 - w) * prev[i][1]]) : raw);
    const V = pose.visibility, vis = (i: number) => V[i] >= this.visTh;
    if (![L_SHOULDER, R_SHOULDER, L_HIP, R_HIP].every(vis)) return this.forget();
    const hip = mid(P[L_HIP], P[R_HIP]), sh = mid(P[L_SHOULDER], P[R_SHOULDER]);
    const T = Math.max(dist(hip, sh), 1e-6);

    if (phase !== 'tracking') {
      if (this.base) this.recalibrate();
      if (phase === 'calibrating') this.samples.push(this.sample(P, vis, hip, T));
      return this.forget();
    }
    if (!this.base) {
      if (this.samples.length < this.c.min_samples) {
        this.samples.push(this.sample(P, vis, hip, T));
        return this.forget();
      }
      const legs = this.samples.map(s => s.leg).filter((v): v is number => v !== null);
      this.base = {
        torso: median(this.samples.map(s => s.torso)), shoulders: median(this.samples.map(s => s.shoulders)),
        hipX: median(this.samples.map(s => s.hipX)), hipY: median(this.samples.map(s => s.hipY)), leg: legs.length ? median(legs) : null,
      };
    }
    if (!counting) return this.forget();
    this.measured = true;

    const t = tMs / 1000, dt = this.lastT === null ? 0 : Math.min(t - this.lastT, this.c.max_dt_s);
    this.lastT = t;
    this.turn(t, P, V, T);
    if (this.facing === 'front') {
      for (const s of SIDES) {
        this.reach(t, s, P, vis, T);
        this.circle(t, s, P, vis, T);
      }
      this.clap(t, P, vis, T);
      this.lean(hip, sh);
    } else {
      this.armsOff();
    }
    this.commitReaches(t);
    this.legs(P, vis, hip, T);
    this.space(P, vis, hip, T, dt);
  }

  private sample(P: P2[], vis: (i: number) => boolean, hip: P2, T: number): Base {
    const ankles = [L_ANKLE, R_ANKLE].filter(vis);
    const leg = ankles.length ? (ankles.reduce((s, i) => s + P[i][1], 0) / ankles.length - hip[1]) / T : null;
    return { torso: T, shoulders: dist(P[L_SHOULDER], P[R_SHOULDER]) / T, hipX: hip[0], hipY: hip[1], leg };
  }

  /** Lost the dancer or stopped counting: drop half-seen moves, keep totals and the reference. */
  private forget(): void {
    this.smooth = null;
    this.lastT = null;
    this.armsOff();
    this.pending = [];
    this.liftPeak = bySide(() => null);
    this.prevAnkle = bySide(() => null);
  }

  private armsOff(): void {
    this.reachEp = bySide(() => null);
    this.circleSteps = bySide(() => []);
    this.circlePrev = bySide(() => null);
    this.clapOn = false;
  }

  /** Arm straight and away from the body. Direction = the highest point reached; counted once per extension. */
  private reach(t: number, s: Side, P: P2[], vis: (i: number) => boolean, T: number): void {
    const c = this.c, [a, e, w] = ARM[s];
    if (![a, e, w].every(vis)) {
      this.reachEp[s] = null;
      return;
    }
    const len = dist(P[w], P[a]), ext = len / Math.max(dist(P[e], P[a]) + dist(P[w], P[e]), 1e-6);
    const angle = deg(Math.atan2(Math.abs(P[w][0] - P[a][0]), P[w][1] - P[a][1])); // 0 = hanging down, 180 = straight up
    const ep = this.reachEp[s];
    const out = ext > (ep ? c.reach_ext_off : c.reach_ext_on) && len > c.reach_min_len * T && angle >= c.reach_min_deg;
    if (out) {
      if (!ep) {
        this.reachEp[s] = { start: t, maxDeg: angle, off: null, done: false };
        return;
      }
      ep.maxDeg = Math.max(ep.maxDeg, angle);
      ep.off = null;
      if (!ep.done && t - ep.start >= c.reach_hold_s) this.finishReach(t, s, ep);
    } else if (ep) {
      ep.off ??= t;
      if (t - ep.off < c.reach_off_s) return;
      if (!ep.done && ep.off - ep.start >= c.reach_min_s) this.finishReach(t, s, ep);
      this.reachEp[s] = null;
    }
  }

  private finishReach(t: number, s: Side, ep: ReachEpisode): void {
    ep.done = true;
    if (t - this.circleAt[s] < this.c.circle_quiet_s) return; // the tail of an arm circle
    const dir: ReachDir = ep.maxDeg >= this.c.reach_up_deg ? 'up' : ep.maxDeg >= this.c.reach_side_deg ? 'side' : 'down';
    this.pending.push({ t, side: s, dir });
  }

  /** A reach counts only if no arm circle claims the same swing shortly after. */
  private commitReaches(t: number): void {
    this.pending = this.pending.filter(p => {
      if (t - p.t < this.c.reach_commit_s) return true;
      this.totals.reach[p.side][p.dir] += 1;
      return false;
    });
  }

  /** The wrist sweeps (almost) a full turn around the shoulder within circle_window_s. */
  private circle(t: number, s: Side, P: P2[], vis: (i: number) => boolean, T: number): void {
    const c = this.c, [a, , w] = ARM[s], steps = this.circleSteps[s];
    if (!vis(a) || !vis(w) || dist(P[w], P[a]) < c.circle_min_len * T) {
      this.circleSteps[s] = [];
      this.circlePrev[s] = null;
      return;
    }
    const phi = Math.atan2(P[w][1] - P[a][1], P[w][0] - P[a][0]), prev = this.circlePrev[s];
    this.circlePrev[s] = phi;
    if (prev === null) return;
    steps.push({ t, d: ((phi - prev + 3 * Math.PI) % (2 * Math.PI)) - Math.PI });
    while (steps.length && t - steps[0].t > c.circle_window_s) steps.shift();
    if (Math.abs(steps.reduce((sum, x) => sum + x.d, 0)) < c.circle_turns * 2 * Math.PI) return;
    this.circleSteps[s] = [];
    this.totals.circle[s] += 1;
    this.circleAt[s] = t;
    this.pending = this.pending.filter(p => p.side !== s);
    this.reachEp[s] = null;
  }

  private clap(t: number, P: P2[], vis: (i: number) => boolean, T: number): void {
    if (!vis(L_WRIST) || !vis(R_WRIST)) {
      this.clapOn = false;
      return;
    }
    const d = dist(P[L_WRIST], P[R_WRIST]) / T;
    if (!this.clapOn && d < this.c.clap_on && t - this.clapAt > this.c.clap_gap_s) {
      this.clapOn = true;
      this.clapAt = t;
      this.totals.clap += 1;
    } else if (this.clapOn && d > this.c.clap_off) {
      this.clapOn = false;
    }
  }

  /** Ankle path relative to the hip, and lifts: one ankle well above the other (a jump lifts both, so it isn't one). */
  private legs(P: P2[], vis: (i: number) => boolean, hip: P2, T: number): void {
    const c = this.c;
    for (const s of SIDES) {
      if (!vis(ANKLE[s])) {
        this.prevAnkle[s] = null;
        continue;
      }
      const rel: P2 = [(P[ANKLE[s]][0] - hip[0]) / T, (P[ANKLE[s]][1] - hip[1]) / T], prev = this.prevAnkle[s];
      if (prev) this.totals.legTravel[s] += dist(rel, prev);
      this.prevAnkle[s] = rel;
    }
    if (!vis(L_ANKLE) || !vis(R_ANKLE)) return;
    for (const s of SIDES) {
      const lift = (P[ANKLE[OTHER[s]]][1] - P[ANKLE[s]][1]) / T;
      const reach = Math.max(lift, Math.abs(P[ANKLE[s]][0] - hip[0]) / T - c.lift_spread_rest);
      const peak = this.liftPeak[s];
      if (peak === null) {
        if (lift > c.lift_on) this.liftPeak[s] = reach;
        continue;
      }
      this.liftPeak[s] = Math.max(peak, reach);
      if (lift >= c.lift_off) continue;
      this.totals.lift[s][this.liftPeak[s]! >= c.lift_big ? 'big' : 'small'] += 1;
      this.liftPeak[s] = null;
    }
  }

  /**
   * Facing from the shoulder width (narrow = side) and the face / shoulder order (back). Half turns:
   * front -> side -> back, and back -> side -> front. Pose models often keep "front" labels on a dancer's back,
   * so two quick front -> side -> front dips also count as one full turn.
   */
  private turn(t: number, P: P2[], V: number[], T: number): void {
    const c = this.c, base = this.base!;
    const ratio = dist(P[L_SHOULDER], P[R_SHOULDER]) / T / base.shoulders;
    const flipped = P[L_SHOULDER][0] < P[R_SHOULDER][0];
    const face: Facing = ratio < c.turn_side_ratio ? 'side' : V[NOSE] < c.turn_face_vis || flipped ? 'back' : 'front';
    if (face === this.facing) {
      this.candidate = null;
      return;
    }
    if (face !== this.candidate) {
      this.candidate = face;
      this.candidateN = 0;
    }
    if (++this.candidateN < c.turn_confirm_frames) return;
    const h = (this.facingHist = [...this.facingHist, face].slice(-6));
    this.facing = face;
    this.candidate = null;
    if (face === 'back') {
      if (h.at(-2) !== 'back') this.totals.turnHalves += 1;
    } else if (face === 'front' && h.at(-2) === 'side') {
      if (h.at(-3) === 'back') {
        this.totals.turnHalves += 1;
      } else if (t - this.lastDip <= c.turn_spin_s) {
        this.totals.turnHalves += 2;
        this.lastDip = -Infinity;
      } else {
        this.lastDip = t;
      }
    }
  }

  /** Space from the calibrated spot. Skipped while the dancer is much nearer or farther than at calibration. */
  private space(P: P2[], vis: (i: number) => boolean, hip: P2, T: number, dt: number): void {
    const c = this.c, base = this.base!;
    if (Math.abs(T / base.torso - 1) > c.max_scale_change) return;
    const lat = (hip[0] - base.hipX) / base.torso; // + = toward the dancer's left
    const col = lat > c.travel ? 0 : lat < -c.travel ? 2 : 1;
    if (col !== this.col && col !== 1) this.totals.travel[col === 0 ? 'l' : 'r'] += 1;
    this.col = col;

    const rise = (base.hipY - hip[1]) / base.torso;
    const ankles = [L_ANKLE, R_ANKLE].filter(vis);
    const leg = ankles.length && base.leg ? (ankles.reduce((s, i) => s + P[i][1], 0) / ankles.length - hip[1]) / T / base.leg : null;
    if (!this.jumpOn && rise > c.jump_on) {
      this.jumpOn = true;
      this.totals.jump += 1;
    } else if (this.jumpOn && rise < c.jump_off) {
      this.jumpOn = false;
    }
    const low = (leg !== null && leg < c.low_leg) || -rise > c.low_drop;
    if (low && !this.lowOn) {
      this.lowOn = true;
      this.totals.low += 1;
    } else if (this.lowOn && !low && (leg === null || leg > c.low_leg_off)) {
      this.lowOn = false;
    }
    const row = rise > c.high_rise || (leg !== null && leg > c.high_leg) ? 0 : this.lowOn ? 2 : 1;
    this.totals.spaceMs[row * 3 + col] += 1000 * dt;
  }

  private lean(hip: P2, sh: P2): void {
    const angle = deg(Math.atan2(sh[0] - hip[0], hip[1] - sh[1])); // + = shoulders toward the dancer's left
    if (this.leanOn === null && Math.abs(angle) > this.c.lean_on_deg) {
      this.leanOn = angle > 0 ? 'l' : 'r';
      this.totals.lean[this.leanOn] += 1;
    } else if (this.leanOn !== null && Math.abs(angle) < this.c.lean_off_deg) {
      this.leanOn = null;
    }
  }
}
