// Movement labels from pose frames: how the last few seconds were danced, in words a display can show.
// Self-contained (no React, no imports from the tracker): feed frames in, read a label out.
//   speed · size · direction · texture · lead part · timing against the beat
// Positions are 2D image landmarks, hip-centred and measured in torso lengths, so distance to the camera and
// body size drop out. Thresholds are first values tuned on the scripted demo figures, not on real dancers.

export type Speed = 'still' | 'slow' | 'medium' | 'fast';
export type Size = 'small' | 'medium' | 'large';
export type Direction = 'in place' | 'left' | 'right' | 'up' | 'down' | 'side to side' | 'up-down';
export type Texture = 'smooth' | 'sharp';
export type Part = 'head' | 'torso' | 'arm_l' | 'arm_r' | 'leg_l' | 'leg_r' | 'whole body';
export type Timing = 'on beat' | 'off beat' | 'mixed';
export type MovementLabel = {
  speed: Speed; size: Size; direction: Direction;
  texture: Texture | null; lead: Part | null; timing: Timing | null; // null = nothing to say (standing still, music stopped)
};
/** One pose frame: 33 landmarks as [x, y] in 0..1 image coordinates, visibility 0..1 each, frame width / height. */
export type MovementFrame = { tMs: number; image: ArrayLike<ArrayLike<number>>; visibility: ArrayLike<number>; aspect: number; musicT: number | null; beatS: number | null };

export const MOVEMENT_DEFAULTS = {
  window_s: 4, // about one 8-count
  visibility: 0.5,
  smooth: 0.5, // share of the new position per frame (landmark jitter would read as speed)
  speed: { still: 0.12, slow: 0.5, fast: 1.3 }, // torso lengths per second
  size: { small: 0.35, large: 1.0 }, // reach of the widest hand or foot path, torso lengths
  travel: 0.35, // hip travel that counts as going somewhere, torso lengths
  sharp: 2.6, // peak speed over mean speed
  lead_share: 0.34, // below this no single part leads
  beat_near: 0.2, // a speed peak this close to a beat (fraction of a beat) is on it
};
export type MovementConfig = typeof MOVEMENT_DEFAULTS;

const SHOULDERS = [11, 12], HIPS = [23, 24];
const PARTS: { name: Exclude<Part, 'torso' | 'whole body'>; joints: number[] }[] = [
  { name: 'head', joints: [0] }, { name: 'arm_l', joints: [13, 15] }, { name: 'arm_r', joints: [14, 16] },
  { name: 'leg_l', joints: [25, 27] }, { name: 'leg_r', joints: [26, 28] },
];
const ENDS = [15, 16, 27, 28]; // wrists and ankles: what "size" is read from
const JOINTS = [...new Set(PARTS.flatMap(p => p.joints))];
type Sample = { t: number; music: number | null; beat: number | null; hip: [number, number]; rel: Map<number, [number, number]> };

export class MovementClassifier {
  private samples: Sample[] = [];
  constructor(private readonly cfg: MovementConfig = MOVEMENT_DEFAULTS) {}

  reset(): void { this.samples = []; }

  /** Feed one frame. Frames without a visible trunk are skipped; a hidden joint keeps its last position. */
  add(f: MovementFrame): void {
    const seen = (i: number) => f.visibility[i] >= this.cfg.visibility;
    if (![...SHOULDERS, ...HIPS].every(seen)) return;
    const at = (i: number): [number, number] => [f.image[i][0] * f.aspect, f.image[i][1]];
    const mid = (a: number, b: number): [number, number] => [(at(a)[0] + at(b)[0]) / 2, (at(a)[1] + at(b)[1]) / 2];
    const sh = mid(11, 12), hipRaw = mid(23, 24), torso = Math.hypot(sh[0] - hipRaw[0], sh[1] - hipRaw[1]);
    if (!(torso > 1e-4)) return;
    const prev = this.samples[this.samples.length - 1], a = prev ? this.cfg.smooth : 1;
    const ease = (now: [number, number], was?: [number, number]): [number, number] => (was ? [was[0] + a * (now[0] - was[0]), was[1] + a * (now[1] - was[1])] : now);
    const hip = ease([hipRaw[0] / torso, hipRaw[1] / torso], prev?.hip);
    const rel = new Map<number, [number, number]>();
    for (const j of JOINTS) {
      const was = prev?.rel.get(j);
      if (seen(j)) rel.set(j, ease([(at(j)[0] - hipRaw[0]) / torso, (at(j)[1] - hipRaw[1]) / torso], was));
      else if (was) rel.set(j, was);
    }
    const t = f.tMs / 1000;
    if (prev && t <= prev.t) this.samples = []; // the clock went back: a new camera
    this.samples.push({ t, music: f.musicT, beat: f.beatS, hip, rel });
    while (this.samples.length && t - this.samples[0].t > this.cfg.window_s) this.samples.shift();
  }

  /** The label of the current window; null until it holds about a second of frames. */
  label(): MovementLabel | null {
    const s = this.samples, c = this.cfg;
    if (s.length < 8 || s[s.length - 1].t - s[0].t < 1) return null;
    const names: Part[] = [...PARTS.map(p => p.name), 'torso'];
    const sums = names.map(() => 0), total: number[] = [];
    for (let i = 1; i < s.length; i++) {
      const dt = s[i].t - s[i - 1].t;
      if (!(dt > 0)) continue;
      const step = (a?: [number, number], b?: [number, number]) => (a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) / dt : 0);
      const v = PARTS.map(p => p.joints.reduce((n, j) => n + step(s[i - 1].rel.get(j), s[i].rel.get(j)), 0) / p.joints.length);
      v.push(step(s[i - 1].hip, s[i].hip));
      v.forEach((x, k) => { sums[k] += x; });
      total.push(v.reduce((n, x) => n + x, 0) / v.length);
    }
    const mean = total.reduce((n, x) => n + x, 0) / Math.max(1, total.length);
    const speed: Speed = mean < c.speed.still ? 'still' : mean < c.speed.slow ? 'slow' : mean < c.speed.fast ? 'medium' : 'fast';

    const span = (get: (x: Sample) => [number, number] | undefined) => {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const q of s) { const p = get(q); if (p) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); } }
      return x1 >= x0 ? { w: x1 - x0, h: y1 - y0 } : { w: 0, h: 0 };
    };
    const hipSpan = span(q => q.hip);
    const reach = Math.max(...ENDS.map(j => { const b = span(q => q.rel.get(j)); return Math.hypot(b.w, b.h); }), Math.hypot(hipSpan.w, hipSpan.h));
    const size: Size = reach < c.size.small ? 'small' : reach < c.size.large ? 'medium' : 'large';

    // Image x grows to the dancer's left (the camera faces them); image y grows downwards.
    const dx = s[s.length - 1].hip[0] - s[0].hip[0], dy = s[s.length - 1].hip[1] - s[0].hip[1];
    const direction: Direction =
      Math.abs(dx) >= c.travel && Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'left' : 'right')
      : Math.abs(dy) >= c.travel ? (dy > 0 ? 'down' : 'up')
      : hipSpan.w >= c.travel && hipSpan.w >= hipSpan.h ? 'side to side'
      : hipSpan.h >= c.travel ? 'up-down' : 'in place';

    if (speed === 'still') return { speed, size, direction, texture: null, lead: null, timing: null };
    const texture: Texture = Math.max(...total) / mean >= c.sharp ? 'sharp' : 'smooth';
    const all = sums.reduce((n, x) => n + x, 0), top = sums.indexOf(Math.max(...sums));
    const lead: Part = all > 0 && sums[top] / all >= c.lead_share ? names[top] : 'whole body';

    // Timing: where in the beat the speed peaks fall.
    let peaks = 0, on = 0;
    for (let i = 1; i < total.length - 1; i++) {
      const q = s[i + 1]; // total[i] is the step into sample i + 1
      if (total[i] < mean || total[i] < total[i - 1] || total[i] <= total[i + 1] || q.music === null || !q.beat || q.beat <= 0) continue;
      const phase = ((q.music / q.beat) % 1 + 1) % 1;
      peaks++;
      if (Math.min(phase, 1 - phase) <= c.beat_near) on++;
    }
    const timing: Timing | null = peaks < 3 ? null : on / peaks >= 0.6 ? 'on beat' : on / peaks <= 0.3 ? 'off beat' : 'mixed';
    return { speed, size, direction, texture, lead, timing };
  }
}
