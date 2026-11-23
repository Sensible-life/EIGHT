// Live movement words for the display: what each body part did in the last few seconds and where the dancer is
// in the space. Moved from server/app/movement.js (the webcam page) so the phone and the webcam read the same way.
//   parts   arm_l, arm_r, leg_l, leg_r, torso: each { kind, speed, size, texture, toward, timing }
//             limb kinds   hold · reach (straight out / back in) · circle (around the shoulder or the elbow; hip or
//                          knee) · swing · shake; legs also step (a foot leaves its spot and lands while the other holds)
//             torso kinds  hold · shift (hips move, feet stay) · travel (feet move too) · jump · drop
//           A part seen in too little of the window is unknown (every field null), never "still" (principle 4).
//   space   where the hips are against the home spot (standing still for calibrate_s): zone, level, depth, weight
//   whole   one summary of the body: speed, size, direction, texture, lead, timing
// Lengths are in torso lengths (shoulder middle to hip middle), so camera distance and body size drop out.
// 2D only: a reach towards the camera or a spin on the spot is not seen. Thresholds: config `labels` (tune).
import { DEFAULT_CONFIG, type TrackingConfig } from './config';

type Cfg = TrackingConfig['labels'];
type P2 = [number, number];
export type Zone = 'left' | 'center' | 'right';
export type Speed = 'still' | 'slow' | 'medium' | 'fast';
export type Size = 'small' | 'medium' | 'large';
export type Texture = 'smooth' | 'sharp' | null;
export type Timing = 'on beat' | 'off beat' | 'mixed' | null;
export type PartName = 'arm_l' | 'arm_r' | 'leg_l' | 'leg_r' | 'torso';
export type PartKind = 'hold' | 'reach' | 'circle' | 'swing' | 'shake' | 'step' | 'shift' | 'travel' | 'jump' | 'drop';
export type PartLabel = { kind: PartKind | null; speed: Speed | null; size: Size | null; texture: Texture; toward: 'up' | 'side' | 'down' | null; timing: Timing };
export type SpaceLabel = { zone: Zone; level: 'low' | 'mid' | 'high'; depth: 'near' | 'home' | 'far'; weight: Zone; x: number; y: number; width: number };
export type Direction = 'in place' | 'left' | 'right' | 'up' | 'down' | 'side to side' | 'up-down';
export type Lead = 'head' | PartName | 'whole body' | null;
export type MovementLabel = {
  speed: Speed; size: Size; direction: Direction; texture: Texture; lead: Lead; timing: Timing;
  values: { speed: number; reach: number; travel: [number, number] };
  parts: Record<PartName, PartLabel>;
  space: SpaceLabel | null;
};
/** One frame: image landmarks (0..1, not mirrored; image x grows to the dancer's left), visibility, frame width / height. */
export type LabelFrame = { tMs: number; image: [number, number][]; visibility: number[]; aspect: number; musicT: number | null; beatS: number | null };

const LIMBS = [
  { name: 'arm_l', root: 11, mid: 13, end: 15 }, { name: 'arm_r', root: 12, mid: 14, end: 16 },
  { name: 'leg_l', root: 23, mid: 25, end: 27 }, { name: 'leg_r', root: 24, mid: 26, end: 28 },
] as const;
const TRUNK = [11, 12, 23, 24];
const JOINTS = [0, ...TRUNK, 13, 14, 15, 16, 25, 26, 27, 28];
const UNKNOWN: PartLabel = { kind: null, speed: null, size: null, texture: null, toward: null, timing: null };
const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const len = (v: P2) => Math.hypot(v[0], v[1]);
const mean = (a: number[]) => a.reduce((n, x) => n + x, 0) / (a.length || 1);
const r2 = (x: number) => Math.round(100 * x) / 100;
const known = (a: (number | null)[]) => a.filter((x): x is number => x !== null);
const box = (pts: P2[]) => { // extent of a path
  if (!pts.length) return { w: 0, h: 0, d: 0 };
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  return { w, h, d: Math.hypot(w, h) };
};
/** How far a vector turned around its origin along a path (radians, signed), and the lowest and highest it got. */
const winding = (path: P2[]) => {
  let turn = 0, lo = 0, hi = 0;
  for (let i = 1; i < path.length; i++) {
    let da = Math.atan2(path[i][1], path[i][0]) - Math.atan2(path[i - 1][1], path[i - 1][0]);
    da -= 2 * Math.PI * Math.round(da / (2 * Math.PI));
    turn += da; lo = Math.min(lo, turn); hi = Math.max(hi, turn);
  }
  return { turn, lo, hi };
};

type Sample = { t: number; music: number | null; beat: number | null; T: number; hip: P2; feet: P2 | null; rel: Map<number, P2> };
type Home = { hip: P2; T: number; feet: P2; leg: number };
type Described = { speed: Speed; size: Size; texture: Texture; timing: Timing; mean: number };

export class MovementLabeler {
  private samples: Sample[] = [];
  private home: Home | null = null;
  private used = { left: 0, right: 0 };
  private zones: { t: number; zone: Zone }[] = [];

  constructor(private readonly cfg: Cfg = DEFAULT_CONFIG.labels) {}

  /** Forget everything, including the home spot: the next still stand calibrates again. */
  reset(): void {
    this.samples = [];
    this.home = null;
    this.used = { left: 0, right: 0 };
    this.zones = [];
  }

  get calibrated(): boolean {
    return this.home !== null;
  }

  /** Feed one frame. Frames without a visible trunk are skipped; a hidden joint is left out of the frame, not carried. */
  add(f: LabelFrame): void {
    const c = this.cfg, seen = (i: number) => f.visibility[i] >= c.visibility;
    if (!TRUNK.every(seen)) return;
    const at = (i: number): P2 => [f.image[i][0] * f.aspect, f.image[i][1]]; // square units: image heights
    const mid = (a: P2, b: P2): P2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const hipRaw = mid(at(23), at(24)), T = len(sub(mid(at(11), at(12)), hipRaw));
    if (!(T > 1e-4)) return;
    const t = f.tMs / 1000;
    if (this.samples.length && t <= this.samples[this.samples.length - 1].t) { this.samples = []; this.zones = []; } // the clock went back: a new camera
    const prev = this.samples[this.samples.length - 1], a = prev ? c.smooth : 1;
    const ease = (now: P2, was: P2 | null | undefined): P2 => (was ? [was[0] + a * (now[0] - was[0]), was[1] + a * (now[1] - was[1])] : now);
    const rel = new Map<number, P2>(); // joint -> position from the hip middle, torso lengths
    for (const j of JOINTS) if (seen(j)) rel.set(j, ease([(at(j)[0] - hipRaw[0]) / T, (at(j)[1] - hipRaw[1]) / T], prev?.rel.get(j)));
    const feet = seen(27) && seen(28) ? ease(mid(at(27), at(28)), prev?.feet) : null; // image units, like hip
    this.samples.push({ t, music: f.musicT ?? null, beat: f.beatS ?? null, T: prev ? prev.T + a * (T - prev.T) : T, hip: ease(hipRaw, prev?.hip), feet, rel });
    while (t - this.samples[0].t > c.window_s) this.samples.shift();
    if (!this.home) this.calibrate();
    if (!this.home) return;
    const x = (this.samples[this.samples.length - 1].hip[0] - this.home.hip[0]) / this.home.T; // how far to each side, since calibration
    this.used.left = Math.max(this.used.left, x);
    this.used.right = Math.max(this.used.right, -x);
    this.zones.push({ t, zone: x >= c.space.zone ? 'left' : x <= -c.space.zone ? 'right' : 'center' });
    while (t - this.zones[0].t > c.zone_history_s) this.zones.shift();
  }

  /** Share of the last `windowS` seconds spent in each zone (time weighted); null before calibration or without history. */
  zoneShares(windowS: number): Record<Zone, number> | null {
    const z = this.zones;
    if (!this.home || z.length < 2) return null;
    const from = z[z.length - 1].t - windowS, time: Record<Zone, number> = { left: 0, center: 0, right: 0 };
    for (let i = 1; i < z.length; i++) if (z[i].t > from) time[z[i].zone] += Math.min(z[i].t - z[i - 1].t, 0.25);
    const total = time.left + time.center + time.right;
    return total > 0 ? { left: time.left / total, center: time.center / total, right: time.right / total } : null;
  }

  /** Home = the dancer standing still for calibrate_s: hip spot, torso size, leg length, feet spot. */
  private calibrate(): void {
    const s = this.samples, last = s[s.length - 1], w = s.filter(q => last.t - q.t <= this.cfg.calibrate_s);
    if (last.t - s[0].t < this.cfg.calibrate_s || w.some(q => !q.feet)) return;
    const T = mean(w.map(q => q.T));
    const moved = Math.max(box(w.map(q => q.hip)).d / T, ...[15, 16, 27, 28].map(j => box(w.map(q => q.rel.get(j)).filter((p): p is P2 => !!p)).d));
    if (moved > this.cfg.speed.still * this.cfg.calibrate_s) return;
    const hip: P2 = [mean(w.map(q => q.hip[0])), mean(w.map(q => q.hip[1]))], feet: P2 = [mean(w.map(q => q.feet![0])), mean(w.map(q => q.feet![1]))];
    this.home = { hip, T, feet, leg: (feet[1] - hip[1]) / T };
    this.used = { left: 0, right: 0 };
    this.zones = [];
  }

  /** Speed, size, texture and timing of one speed series (torso lengths / s per step; null = not seen) and its path extent. */
  private describe(v: (number | null)[], extent: number): Described {
    const c = this.cfg, s = this.samples, vals = known(v), m = mean(vals);
    const speed: Speed = m < c.speed.still ? 'still' : m < c.speed.slow ? 'slow' : m < c.speed.fast ? 'medium' : 'fast';
    const size: Size = extent < c.size.small ? 'small' : extent < c.size.large ? 'medium' : 'large';
    if (speed === 'still') return { speed, size, texture: null, timing: null, mean: m };
    let peaks = 0, on = 0; // timing: where in the beat the speed peaks fall
    for (let i = 1; i < v.length - 1; i++) {
      const p = v[i - 1], x = v[i], n = v[i + 1], q = s[i + 1]; // v[i] is the step into sample i + 1
      if (p === null || x === null || n === null) continue;
      if (x < m || x < p || x <= n || q.music === null || !(q.beat !== null && q.beat > 0)) continue;
      const phase = ((q.music / q.beat) % 1 + 1) % 1;
      peaks++;
      if (Math.min(phase, 1 - phase) <= c.beat_near) on++;
    }
    const timing: Timing = peaks < 3 ? null : on / peaks >= 0.6 ? 'on beat' : on / peaks <= 0.3 ? 'off beat' : 'mixed';
    return { speed, size, texture: Math.max(...vals) / m >= c.sharp ? 'sharp' : 'smooth', timing, mean: m };
  }

  /**
   * Steps of one foot, read where it is in the room (torso lengths): it lifts or slides off its spot and lands again
   * while the other foot holds the weight, so a jump or the whole body sliding over is no step. `lift` is the highest
   * it rose above the floor, so a kick or a knee lift can be told apart from a step.
   */
  private steps(foot: number, other: number, scale: number): { count: number; lift: number; speeds: (number | null)[]; extent: number } {
    const c = this.cfg.step, s = this.samples;
    const at = (q: Sample, j: number): P2 | null => { const r = q.rel.get(j); return r ? [(q.hip[0] + r[0] * q.T) / scale, (q.hip[1] + r[1] * q.T) / scale] : null; };
    const F = s.map(q => at(q, foot)), O = s.map(q => at(q, other));
    const ys = [...F, ...O].filter((p): p is P2 => p !== null).map(p => p[1]);
    const floor = ys.length ? Math.max(...ys) : 0; // image y grows down: the floor is the lowest a foot got
    const speed = (P: (P2 | null)[], i: number) => { const a = P[i - 1], b = P[i]; return i > 0 && a && b ? len(sub(b, a)) / (s[i].t - s[i - 1].t) : null; };
    const planted = (P: (P2 | null)[], i: number) => { const v = speed(P, i), p = P[i]; return !!p && v !== null && v < c.plant_speed && floor - p[1] <= c.lift / 2; };
    let count = 0, lift = 0, spot: P2 | null = null, away: { top: number; otherDown: number; n: number } | null = null;
    for (let i = 1; i < s.length; i++) {
      const p = F[i];
      if (p) lift = Math.max(lift, floor - p[1]);
      if (planted(F, i) && p) {
        // landed: a step if the foot rose or ended up somewhere else, and the other foot stood the whole time
        if (away && spot && (away.top >= c.lift || Math.abs(p[0] - spot[0]) >= c.move) && away.otherDown >= 0.8 * away.n) count++;
        away = null; spot = p;
      } else if (spot) {
        away ??= { top: 0, otherDown: 0, n: 0 };
        away.n++;
        if (p) away.top = Math.max(away.top, floor - p[1]);
        if (planted(O, i)) away.otherDown++;
      }
    }
    return { count, lift, speeds: s.slice(1).map((_, i) => speed(F, i + 1)), extent: box(F.filter((x): x is P2 => x !== null)).d };
  }

  /** Everything about the current window; null until it holds about a second of frames. */
  label(): MovementLabel | null {
    const s = this.samples, c = this.cfg;
    if (s.length < 8 || s[s.length - 1].t - s[0].t < 1) return null;
    const scale = this.home?.T ?? mean(s.map(q => q.T)); // one ruler for travel: per-frame torso size would hide walking closer
    const steps = (get: (q: Sample) => P2 | null | undefined) => s.slice(1).map((q, i) => { const p0 = get(s[i]), p1 = get(q); return p0 && p1 ? len(sub(p1, p0)) / (q.t - s[i].t) : null; });
    const seenEnough = (v: (number | null)[]) => v.length > 0 && known(v).length / v.length >= c.min_seen;
    const out = (d: Described): PartLabel => ({ kind: null, speed: d.speed, size: d.size, texture: d.texture, toward: null, timing: d.timing });
    const parts = {} as Record<PartName, PartLabel>, means: Partial<Record<'head' | PartName, number>> = {}, series: (number | null)[][] = [];
    const knownLimbs: (typeof LIMBS)[number][] = [];

    for (const L of LIMBS) {
      const vEnd = steps(q => q.rel.get(L.end)), vMid = steps(q => q.rel.get(L.mid));
      const v = vEnd.map((x, i) => (x !== null && vMid[i] !== null ? (x + vMid[i]!) / 2 : null));
      if (!seenEnough(v)) { parts[L.name] = { ...UNKNOWN }; continue; } // hidden or out of frame: unknown, not still
      knownLimbs.push(L);
      series.push(v);
      const tip = (q: Sample): P2 | null => { const e = q.rel.get(L.end), r = q.rel.get(L.root); return e && r ? sub(e, r) : null; }; // hand from shoulder, foot from hip
      const path = s.map(tip).filter((p): p is P2 => p !== null);
      const d = this.describe(v, box(path).d), p = out(d);
      means[L.name] = d.mean;
      if (path.length) {
        const full = Math.max(...s.map(q => { const r = q.rel.get(L.root), m = q.rel.get(L.mid), e = q.rel.get(L.end); return r && m && e ? len(sub(m, r)) + len(sub(e, m)) : 0; })) || 1;
        const ext = path.map(p0 => len(p0) / full); // 0 folded .. 1 straight
        const { turn, lo, hi } = winding(path);
        // the hand going around the elbow (the foot around the knee) is a circle too, even when the upper arm stays
        const lower = winding(s.map(q => { const e = q.rel.get(L.end), m = q.rel.get(L.mid); return e && m ? sub(e, m) : null; }).filter((x): x is P2 => x !== null));
        const far = path[ext.indexOf(Math.max(...ext))];
        p.toward = far[1] < -0.5 * len(far) ? 'up' : far[1] > 0.5 * len(far) ? 'down' : 'side';
        const step = L.name === 'leg_l' || L.name === 'leg_r' ? this.steps(L.end, L.name === 'leg_l' ? 28 : 27, scale) : null;
        if (step && step.count >= c.step.min_steps && step.lift <= c.step.max_lift) {
          // steps are read where the foot is in the room: against the hip a walking foot hardly moves
          const sd = this.describe(step.speeds, step.extent);
          p.kind = 'step'; p.speed = sd.speed === 'still' ? 'slow' : sd.speed; p.size = sd.size; p.texture = sd.texture; p.timing = sd.timing;
          means[L.name] = Math.max(d.mean, sd.mean);
        } else {
          p.kind = d.speed === 'still' ? 'hold' : Math.max(Math.abs(turn), Math.abs(lower.turn)) >= c.limb.circle_rad ? 'circle'
            : Math.max(...ext) - Math.min(...ext) >= c.limb.reach ? 'reach' : hi - lo >= c.limb.swing_rad ? 'swing' : 'shake';
        }
      }
      parts[L.name] = p;
    }

    // Torso: the hips in the room (not relative to anything), against the feet and the home spot.
    const hips: P2[] = s.map(q => [q.hip[0] / scale, q.hip[1] / scale]), feet: P2[] = s.filter(q => q.feet).map(q => [q.feet![0] / scale, q.feet![1] / scale]);
    const hipBox = box(hips), feetBox = box(feet), vHip = steps(q => [q.hip[0] / scale, q.hip[1] / scale]), td = this.describe(vHip, hipBox.d), torso = out(td);
    means.torso = td.mean;
    const h = this.home, now = s[s.length - 1];
    const legNow = (q: Sample) => (q.feet ? (q.feet[1] - q.hip[1]) / q.T : null);
    const rise = h ? Math.max(...s.map(q => (h.hip[1] - q.hip[1]) / h.T)) : 0;
    const feetRise = h && feet.length ? Math.max(...s.filter(q => q.feet).map(q => (h.feet[1] - q.feet![1]) / h.T)) : 0;
    const legs = known(s.map(legNow)), legMin = h && legs.length ? Math.min(...legs) / h.leg : 1;
    torso.kind = rise >= c.torso.jump && feetRise >= c.torso.feet_up ? 'jump' : legMin <= c.torso.drop ? 'drop'
      : hipBox.w >= c.travel && feetBox.w >= c.travel ? 'travel' : hipBox.w >= c.torso.shift || td.speed !== 'still' ? 'shift' : 'hold';
    parts.torso = torso;

    // Space: where the hips are against the calibrated standing spot. Image x grows to the dancer's left; y grows down.
    let space: SpaceLabel | null = null;
    if (h) {
      const x = (now.hip[0] - h.hip[0]) / h.T, y = (h.hip[1] - now.hip[1]) / h.T, leg = legNow(now), size = now.T / h.T;
      const off = now.feet ? (now.hip[0] - now.feet[0]) / h.T : 0;
      space = {
        zone: x >= c.space.zone ? 'left' : x <= -c.space.zone ? 'right' : 'center',
        level: leg !== null && leg / h.leg <= c.torso.drop ? 'low' : y >= c.torso.jump ? 'high' : 'mid',
        depth: size >= c.space.near ? 'near' : size <= c.space.far ? 'far' : 'home',
        weight: off >= c.space.weight ? 'left' : off <= -c.space.weight ? 'right' : 'center', // hips over which foot
        x: r2(x), y: r2(y), width: r2(this.used.left + this.used.right),
      };
    }

    // Whole body: one line over the parts that were seen (the head only counts here).
    const vHead = steps(q => q.rel.get(0));
    series.push(vHip);
    if (seenEnough(vHead)) { series.push(vHead); means.head = mean(known(vHead)); }
    const names = Object.keys(means) as ('head' | PartName)[], all = mean(names.map(n => means[n]!));
    const reach = Math.max(hipBox.d, ...knownLimbs.map(L => box(s.map(q => q.rel.get(L.end)).filter((p): p is P2 => !!p)).d));
    const whole = this.describe(vHip.map((_, i) => { const xs = known(series.map(v => v[i])); return xs.length ? mean(xs) : null; }), reach);
    const dx = hips[hips.length - 1][0] - hips[0][0], dy = hips[hips.length - 1][1] - hips[0][1];
    const direction: Direction = Math.abs(dx) >= c.travel && Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'left' : 'right')
      : Math.abs(dy) >= c.travel ? (dy > 0 ? 'down' : 'up')
      : hipBox.w >= c.travel && hipBox.w >= hipBox.h ? 'side to side' : hipBox.h >= c.travel ? 'up-down' : 'in place';
    const top = names.reduce((a, b) => (means[b]! > means[a]! ? b : a));
    return {
      speed: whole.speed, size: whole.size, direction, texture: whole.texture,
      lead: whole.speed === 'still' ? null : means[top]! / (all * names.length) >= c.lead_share ? top : 'whole body', timing: whole.timing,
      values: { speed: r2(all), reach: r2(reach), travel: [r2(dx), r2(dy)] }, parts, space,
    };
  }
}
