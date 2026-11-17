// Movement labels from pose frames: what each body part did in the last few seconds, and where the dancer is
// in the space, in words a display can show. Self-contained ES module: the camera page (movement.html) imports
// it, node runs its test (tests/movement.test.mjs).
//
//   parts   arm_l, arm_r, leg_l, leg_r, torso: each { kind, speed, size, texture, toward, timing }
//             limb kinds   hold · reach (straight out / back in) · circle · swing · shake
//             torso kinds  hold · shift (hips move, feet stay) · travel (feet move too) · jump · drop
//   space   where the hips are against the calibrated standing spot: zone, level, depth, weight, how much was used
//   whole   one summary of the body: speed, size, direction, texture, lead, timing
//
// Frame in: { tMs, image: [[x, y], ...33] (0..1), visibility: [...33], aspect (width / height), musicT, beatS }.
// Lengths are in torso lengths (shoulder middle to hip middle), so camera distance and body size drop out.
// 2D only: a reach towards the camera or a spin on the spot is not seen. Thresholds are first values tuned on
// scripted figures, not on real dancers. The words are the ones server/app/projection.py lets through.

export const MOVEMENT_DEFAULTS = {
  window_s: 4, // about one 8-count
  visibility: 0.5,
  smooth: 0.5, // share of the new position per frame (landmark jitter would read as speed)
  speed: { still: 0.12, slow: 0.5, fast: 1.3 }, // torso lengths per second
  size: { small: 0.35, large: 1.0 }, // extent of the path, torso lengths
  travel: 0.35, // hip travel that counts as going somewhere
  sharp: 2.6, // peak speed over mean speed
  lead_share: 0.34, // below this no single part leads
  beat_near: 0.2, // a speed peak this close to a beat (fraction of a beat) is on it
  limb: { circle_rad: 1.5 * Math.PI, reach: 0.3, swing_rad: 0.5 }, // turn around the root; change of extension (0..1); arc
  torso: { shift: 0.2, jump: 0.2, feet_up: 0.1, drop: 0.75 }, // hips over still feet; hip rise; ankle rise; leg length vs standing
  calibrate_s: 1.5, // standing still this long sets the home spot
  space: { zone: 0.8, near: 1.2, far: 0.83, weight: 0.25 }, // sideways offset; torso size vs home; hips off the feet
};

const LIMBS = [
  { name: 'arm_l', root: 11, mid: 13, end: 15 }, { name: 'arm_r', root: 12, mid: 14, end: 16 },
  { name: 'leg_l', root: 23, mid: 25, end: 27 }, { name: 'leg_r', root: 24, mid: 26, end: 28 },
];
const TRUNK = [11, 12, 23, 24];
const JOINTS = [0, ...TRUNK, 13, 14, 15, 16, 25, 26, 27, 28];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = v => Math.hypot(v[0], v[1]);
const mean = a => a.reduce((n, x) => n + x, 0) / (a.length || 1);
const r2 = x => Math.round(100 * x) / 100;
const box = pts => { // extent of a path
  if (!pts.length) return { w: 0, h: 0, d: 0 };
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  return { w, h, d: Math.hypot(w, h) };
};

export class MovementClassifier {
  constructor(cfg = MOVEMENT_DEFAULTS) { this.cfg = cfg; this.samples = []; this.home = null; this.used = null; }

  /** Forget everything, including the home spot: the next still stand calibrates again. */
  reset() { this.samples = []; this.home = null; this.used = null; }

  get calibrated() { return this.home !== null; }

  /** Feed one frame. Frames without a visible trunk are skipped; a hidden joint keeps its last position. */
  add(f) {
    const c = this.cfg, seen = i => f.visibility[i] >= c.visibility;
    if (!TRUNK.every(seen)) return;
    const at = i => [f.image[i][0] * f.aspect, f.image[i][1]]; // square units: image heights
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const hipRaw = mid(at(23), at(24)), T = len(sub(mid(at(11), at(12)), hipRaw));
    if (!(T > 1e-4)) return;
    const t = f.tMs / 1000;
    if (this.samples.length && t <= this.samples[this.samples.length - 1].t) this.samples = []; // the clock went back: a new camera
    const prev = this.samples[this.samples.length - 1], a = prev ? c.smooth : 1;
    const ease = (now, was) => (was ? [was[0] + a * (now[0] - was[0]), was[1] + a * (now[1] - was[1])] : now);
    const rel = new Map(); // joint -> position from the hip middle, torso lengths
    for (const j of JOINTS) {
      const was = prev?.rel.get(j);
      if (seen(j)) rel.set(j, ease([(at(j)[0] - hipRaw[0]) / T, (at(j)[1] - hipRaw[1]) / T], was));
      else if (was) rel.set(j, was);
    }
    const feet = seen(27) && seen(28) ? ease(mid(at(27), at(28)), prev?.feet) : prev?.feet ?? null; // image units, like hip
    this.samples.push({ t, music: f.musicT ?? null, beat: f.beatS ?? null, T: prev ? prev.T + a * (T - prev.T) : T, hip: ease(hipRaw, prev?.hip), feet, rel });
    while (t - this.samples[0].t > c.window_s) this.samples.shift();
    if (!this.home) this.calibrate();
    else { // how far to each side the hips have been since calibration
      const x = (this.samples[this.samples.length - 1].hip[0] - this.home.hip[0]) / this.home.T;
      this.used.left = Math.max(this.used.left, x); this.used.right = Math.max(this.used.right, -x);
    }
  }

  /** Home = the dancer standing still for calibrate_s: hip spot, torso size, leg length, feet spot. */
  calibrate() {
    const s = this.samples, last = s[s.length - 1], w = s.filter(q => last.t - q.t <= this.cfg.calibrate_s);
    if (last.t - s[0].t < this.cfg.calibrate_s || w.some(q => !q.feet)) return;
    const T = mean(w.map(q => q.T));
    const moved = Math.max(box(w.map(q => q.hip)).d / T, ...[15, 16, 27, 28].map(j => box(w.map(q => q.rel.get(j)).filter(Boolean)).d));
    if (moved > this.cfg.speed.still * this.cfg.calibrate_s) return;
    this.home = { hip: [mean(w.map(q => q.hip[0])), mean(w.map(q => q.hip[1]))], T, feet: [mean(w.map(q => q.feet[0])), mean(w.map(q => q.feet[1]))] };
    this.home.leg = (this.home.feet[1] - this.home.hip[1]) / T;
    this.used = { left: 0, right: 0 };
  }

  /** Speed, size, texture and timing of one speed series (torso lengths / s per step) and its path extent. */
  describe(v, extent) {
    const c = this.cfg, s = this.samples, m = mean(v);
    const speed = m < c.speed.still ? 'still' : m < c.speed.slow ? 'slow' : m < c.speed.fast ? 'medium' : 'fast';
    const size = extent < c.size.small ? 'small' : extent < c.size.large ? 'medium' : 'large';
    if (speed === 'still') return { speed, size, texture: null, timing: null, mean: m };
    let peaks = 0, on = 0; // timing: where in the beat the speed peaks fall
    for (let i = 1; i < v.length - 1; i++) {
      const q = s[i + 1]; // v[i] is the step into sample i + 1
      if (v[i] < m || v[i] < v[i - 1] || v[i] <= v[i + 1] || q.music === null || !(q.beat > 0)) continue;
      const phase = ((q.music / q.beat) % 1 + 1) % 1;
      peaks++;
      if (Math.min(phase, 1 - phase) <= c.beat_near) on++;
    }
    const timing = peaks < 3 ? null : on / peaks >= 0.6 ? 'on beat' : on / peaks <= 0.3 ? 'off beat' : 'mixed';
    return { speed, size, texture: Math.max(...v) / m >= c.sharp ? 'sharp' : 'smooth', timing, mean: m };
  }

  /** Everything about the current window; null until it holds about a second of frames. */
  label() {
    const s = this.samples, c = this.cfg;
    if (s.length < 8 || s[s.length - 1].t - s[0].t < 1) return null;
    const scale = this.home?.T ?? mean(s.map(q => q.T)); // one ruler for travel: per-frame torso size would hide walking closer
    const steps = get => s.slice(1).map((q, i) => { const p0 = get(s[i]), p1 = get(q); return p0 && p1 ? len(sub(p1, p0)) / (q.t - s[i].t) : 0; });
    const out = d => ({ kind: null, speed: d.speed, size: d.size, texture: d.texture, toward: null, timing: d.timing });
    const parts = {}, means = {}, series = [];

    for (const L of LIMBS) {
      const tip = q => { const e = q.rel.get(L.end), r = q.rel.get(L.root); return e && r ? sub(e, r) : null; }; // hand from shoulder, foot from hip
      const path = s.map(tip).filter(Boolean);
      const vEnd = steps(q => q.rel.get(L.end)), vMid = steps(q => q.rel.get(L.mid)), v = vEnd.map((x, i) => (x + vMid[i]) / 2);
      series.push(v);
      const d = this.describe(v, box(path).d), p = out(d);
      means[L.name] = d.mean;
      if (path.length) {
        const full = Math.max(...s.map(q => { const r = q.rel.get(L.root), m = q.rel.get(L.mid), e = q.rel.get(L.end); return r && m && e ? len(sub(m, r)) + len(sub(e, m)) : 0; })) || 1;
        const ext = path.map(p0 => len(p0) / full); // 0 folded .. 1 straight
        let turn = 0, lo = 0, hi = 0;
        for (let i = 1; i < path.length; i++) {
          let da = Math.atan2(path[i][1], path[i][0]) - Math.atan2(path[i - 1][1], path[i - 1][0]);
          da -= 2 * Math.PI * Math.round(da / (2 * Math.PI));
          turn += da; lo = Math.min(lo, turn); hi = Math.max(hi, turn);
        }
        const far = path[ext.indexOf(Math.max(...ext))];
        p.toward = far[1] < -0.5 * len(far) ? 'up' : far[1] > 0.5 * len(far) ? 'down' : 'side';
        p.kind = d.speed === 'still' ? 'hold' : Math.abs(turn) >= c.limb.circle_rad ? 'circle'
          : Math.max(...ext) - Math.min(...ext) >= c.limb.reach ? 'reach' : hi - lo >= c.limb.swing_rad ? 'swing' : 'shake';
      }
      parts[L.name] = p;
    }

    // Torso: the hips in the room (not relative to anything), against the feet and the home spot.
    const hips = s.map(q => [q.hip[0] / scale, q.hip[1] / scale]), feet = s.filter(q => q.feet).map(q => [q.feet[0] / scale, q.feet[1] / scale]);
    const hipBox = box(hips), feetBox = box(feet), vHip = steps(q => [q.hip[0] / scale, q.hip[1] / scale]), td = this.describe(vHip, hipBox.d), torso = out(td);
    means.torso = td.mean;
    const h = this.home, now = s[s.length - 1];
    const rise = h ? Math.max(...s.map(q => (h.hip[1] - q.hip[1]) / h.T)) : 0, feetRise = h ? Math.max(...s.filter(q => q.feet).map(q => (h.feet[1] - q.feet[1]) / h.T)) : 0;
    const legNow = q => (q.feet ? (q.feet[1] - q.hip[1]) / q.T : null), legMin = h ? Math.min(...s.map(legNow).filter(x => x !== null)) / h.leg : 1;
    torso.kind = rise >= c.torso.jump && feetRise >= c.torso.feet_up ? 'jump' : legMin <= c.torso.drop ? 'drop'
      : hipBox.w >= c.travel && feetBox.w >= c.travel ? 'travel' : hipBox.w >= c.torso.shift || td.speed !== 'still' ? 'shift' : 'hold';
    parts.torso = torso;

    // Space: where the hips are against the calibrated standing spot. Image x grows to the dancer's left; y grows down.
    let space = null;
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

    // Whole body: one line over all parts (the head only counts here).
    const vHead = steps(q => q.rel.get(0));
    series.push(vHip, vHead);
    means.head = mean(vHead);
    const names = Object.keys(means), all = mean(names.map(n => means[n]));
    const reach = Math.max(hipBox.d, ...LIMBS.map(L => box(s.map(q => q.rel.get(L.end)).filter(Boolean)).d));
    const whole = this.describe(series[0].map((_, i) => mean(series.map(v => v[i]))), reach);
    const dx = hips[hips.length - 1][0] - hips[0][0], dy = hips[hips.length - 1][1] - hips[0][1];
    const direction = Math.abs(dx) >= c.travel && Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'left' : 'right')
      : Math.abs(dy) >= c.travel ? (dy > 0 ? 'down' : 'up')
      : hipBox.w >= c.travel && hipBox.w >= hipBox.h ? 'side to side' : hipBox.h >= c.travel ? 'up-down' : 'in place';
    const top = names.reduce((a, b) => (means[b] > means[a] ? b : a));
    return {
      speed: whole.speed, size: whole.size, direction, texture: whole.texture,
      lead: whole.speed === 'still' ? null : means[top] / (all * names.length) >= c.lead_share ? top : 'whole body', timing: whole.timing,
      values: { speed: r2(all), reach: r2(reach), travel: [r2(dx), r2(dy)] }, parts, space,
    };
  }
}
