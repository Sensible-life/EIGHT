// Movement labels (src/tracking/labels.ts): scripted figures are read as the way they move.
// Moved from server/tests/movement.test.mjs when the webcam labels joined the tracking code.
const assert = require('./assert.cjs');
const { MovementLabeler } = require('../load-ts.cjs')('src/tracking/labels.ts');
const { rng } = require('./helpers.cjs');

/** A standing figure (33 landmarks, upright 3:4 frame; torso 0.2 high), then `pose(t, P)` moves it. Image x grows to the dancer's left. */
function figure(t, pose) {
  const P = Array.from({ length: 33 }, () => [0.5, 0.5]);
  const set = (i, x, y) => { P[i] = [x, y]; };
  set(0, 0.5, 0.2); set(11, 0.56, 0.3); set(12, 0.44, 0.3); set(13, 0.58, 0.4); set(14, 0.42, 0.4); set(15, 0.59, 0.5); set(16, 0.41, 0.5);
  set(23, 0.53, 0.5); set(24, 0.47, 0.5); set(25, 0.53, 0.65); set(26, 0.47, 0.65); set(27, 0.53, 0.8); set(28, 0.47, 0.8);
  pose?.(t, P);
  return P;
}
const shift = (P, dx, dy, only = () => true) => P.forEach((p, i) => { if (only(i)) { p[0] += dx; p[1] += dy; } });
const UPPER = i => i < 25; // everything but knees and feet
const BEAT = 0.5, STILL = 3; // every run starts with 3 s standing still: the calibration
/** The labeler after `seconds` of the figure moving after the still start (pose gets the time since the movement began). */
function runLabeler(pose, { seconds = 8, music = true, hide = () => [], jitter = 0, seed = 7 } = {}) {
  const c = new MovementLabeler(), r = rng(seed); // jitter: landmark noise like a webcam's (standard deviation, frame heights)
  for (let i = 0; i < (STILL + seconds) * 30; i++) {
    const t = i / 30, hidden = hide(i), image = figure(t - STILL, t >= STILL ? pose : null).map(p => [p[0] + r.normal(jitter), p[1] + r.normal(jitter)]);
    c.add({ tMs: 1000 * t, image, visibility: Array.from({ length: 33 }, (_, j) => (hidden.includes(j) ? 0 : 1)), aspect: 0.75, musicT: music ? t : null, beatS: music ? BEAT : null });
  }
  assert.ok(c.calibrated, 'the still start calibrates');
  return c;
}
const run = (pose, o) => runLabeler(pose, o).label();

assert.equal(new MovementLabeler().label(), null, 'no frames: no label');
{
  const m = run();
  assert.deepEqual([m.speed, m.size, m.direction, m.texture, m.lead, m.timing], ['still', 'small', 'in place', null, null, null]);
  for (const part of ['arm_l', 'arm_r', 'leg_l', 'leg_r', 'torso']) assert.equal(m.parts[part].kind, 'hold', part);
  assert.deepEqual(m.space, { zone: 'center', level: 'mid', depth: 'home', weight: 'center', x: 0, y: 0, width: 0 });
}
assert.equal(run(null, { hide: i => (i % 2 ? [15, 11] : []) }).speed, 'still', 'a hidden hand or trunk invents no movement');

// Each part gets its own kind.
{
  // the left hand circles around the shoulder; the right arm hangs
  const m = run((t, P) => { const a = 2 * Math.PI * t / 2; P[15] = [0.56 + 0.2 * Math.cos(a), 0.3 + 0.2 * Math.sin(a)]; P[13] = [0.56 + 0.1 * Math.cos(a), 0.3 + 0.1 * Math.sin(a)]; });
  assert.equal(m.parts.arm_l.kind, 'circle', JSON.stringify(m.parts.arm_l));
  assert.equal(m.parts.arm_l.texture, 'smooth');
  assert.equal(m.parts.arm_r.kind, 'hold');
  assert.equal(m.parts.torso.kind, 'hold');
  assert.equal(m.lead, 'arm_l');
}
{
  // the right hand punches out to the side on every beat (folded at the shoulder, then straight), the left leg holds
  const m = run((t, P) => { const k = (t / BEAT) % 1, out = k < 0.15 ? k / 0.15 : k < 0.4 ? 1 : 1 - (k - 0.4) / 0.6; P[16] = [0.42 - 0.22 * out, 0.33]; P[14] = [0.43 - 0.1 * out, 0.36 - 0.03 * out]; });
  const arm = m.parts.arm_r;
  assert.deepEqual([arm.kind, arm.toward, arm.texture, arm.timing], ['reach', 'side', 'sharp', 'on beat'], JSON.stringify(arm));
  assert.equal(m.parts.leg_l.kind, 'hold');
}
{
  // the left arm swings like a pendulum, straight the whole time
  const m = run((t, P) => { const a = Math.PI / 2 + 0.6 * Math.sin(Math.PI * t); P[15] = [0.56 + 0.2 * Math.cos(a), 0.3 + 0.2 * Math.sin(a)]; P[13] = [0.56 + 0.1 * Math.cos(a), 0.3 + 0.1 * Math.sin(a)]; });
  assert.equal(m.parts.arm_l.kind, 'swing', JSON.stringify(m.parts.arm_l));
  assert.equal(m.parts.arm_l.toward, 'down');
}
{
  // the right foot kicks out to the side and back
  const m = run((t, P) => { const out = Math.abs(Math.sin(Math.PI * t / BEAT / 2)); P[28] = [0.47 - 0.2 * out, 0.8 - 0.12 * out]; P[26] = [0.47 - 0.1 * out, 0.65 - 0.03 * out]; });
  assert.notEqual(m.parts.leg_r.kind, 'hold', JSON.stringify(m.parts.leg_r));
  assert.equal(m.parts.leg_l.kind, 'hold');
  assert.equal(m.parts.arm_l.kind, 'hold');
}
{
  // both arms swing the same; the left arm (13, 15) is hidden while moving: unknown, not 'hold'
  const swing = (t, P) => { const s = Math.sin(2 * Math.PI * t); P[16][0] -= 0.12 * s; P[14][0] -= 0.06 * s; P[15][0] += 0.12 * s; P[13][0] += 0.06 * s; };
  const m = run(swing, { hide: i => (i >= STILL * 30 ? [13, 15] : []) });
  assert.equal(m.parts.arm_l.kind, null, JSON.stringify(m.parts.arm_l));
  assert.equal(m.parts.arm_l.speed, null);
  assert.notEqual(m.parts.arm_r.kind, 'hold');
  assert.notEqual(m.lead, 'arm_l');
}

{
  // the forearm circles around an elbow that stays (hanging, or out to the side): a circle, not a reach
  for (const elbow of [[0.58, 0.4], [0.66, 0.3]]) {
    const m = run((t, P) => { const a = Math.PI * t; P[13] = [...elbow]; P[15] = [elbow[0] + 0.1 * Math.cos(a), elbow[1] + 0.1 * Math.sin(a)]; });
    assert.equal(m.parts.arm_l.kind, 'circle', `elbow at ${elbow}: ${JSON.stringify(m.parts.arm_l)}`);
  }
}

// Steps: a foot leaves its spot and lands again while the other foot stands.
const lifted = (t, phase) => Math.max(0, Math.sin(Math.PI * t / BEAT + phase));
{
  // marching in place: the feet take turns rising a little
  const m = run((t, P) => { for (const [ankle, knee, phase] of [[27, 25, 0], [28, 26, Math.PI]]) { const up = lifted(t, phase); P[ankle][1] -= 0.04 * up; P[knee][1] -= 0.02 * up; } });
  assert.deepEqual([m.parts.leg_l.kind, m.parts.leg_r.kind], ['step', 'step'], JSON.stringify(m.parts));
  assert.equal(m.parts.leg_l.timing, 'on beat');
  assert.equal(m.parts.torso.kind, 'hold', 'the hips stay');
}
{
  // walking to the side: each foot in turn lifts and lands a little further, the hips follow
  const m = run((t, P) => {
    const n = t / BEAT, i = Math.floor(n), f = n - i, d = 0.05;
    const left = i % 2 === 0 ? (i / 2 + f) * d : ((i + 1) / 2) * d, right = i % 2 === 1 ? ((i - 1) / 2 + f) * d : (i / 2) * d;
    shift(P, (left + right) / 2, 0, UPPER);
    for (const j of [25, 27]) P[j][0] += left;
    for (const j of [26, 28]) P[j][0] += right;
    P[i % 2 === 0 ? 27 : 28][1] -= 0.04 * Math.sin(Math.PI * f);
  });
  assert.deepEqual([m.parts.leg_l.kind, m.parts.leg_r.kind], ['step', 'step'], JSON.stringify(m.parts));
  assert.equal(m.parts.torso.kind, 'travel');
}
{
  // no step: both feet leave the floor together (a jump), or the whole body slides over with them
  const jumpLegs = run((t, P) => shift(P, 0, -0.12 * Math.abs(Math.sin(Math.PI * t / BEAT)))).parts;
  assert.notEqual(jumpLegs.leg_l.kind, 'step', JSON.stringify(jumpLegs.leg_l));
  const slide = run((t, P) => shift(P, 0.12 * Math.sin(Math.PI * t / 2), 0)).parts;
  assert.notEqual(slide.leg_l.kind, 'step', JSON.stringify(slide.leg_l));
  // a kick rises too high for a step
  const kick = run((t, P) => { const out = Math.abs(Math.sin(Math.PI * t / BEAT / 2)); P[28] = [0.47 - 0.2 * out, 0.8 - 0.12 * out]; P[26] = [0.47 - 0.1 * out, 0.65 - 0.03 * out]; }).parts;
  assert.notEqual(kick.leg_r.kind, 'step', JSON.stringify(kick.leg_r));
}

// Camera jitter: the still start measures how much each part seems to move while still, and speeds are taken over
// a tenth of a second, so a part that does not move reads as hold, not shake, while the others really move.
{
  const circleLeft = (t, P) => { const a = Math.PI * t; P[15] = [0.56 + 0.2 * Math.cos(a), 0.3 + 0.2 * Math.sin(a)]; P[13] = [0.56 + 0.1 * Math.cos(a), 0.3 + 0.1 * Math.sin(a)]; };
  for (const jitter of [0.002, 0.004]) for (const seed of [1, 2, 3]) {
    const p = run(circleLeft, { jitter, seed }).parts;
    assert.equal(p.arm_l.kind, 'circle', `jitter ${jitter}: the moving arm`);
    for (const still of ['arm_r', 'leg_l', 'leg_r', 'torso']) assert.equal(p[still].kind, 'hold', `jitter ${jitter} seed ${seed}: still ${still} read as ${p[still].kind}`);
  }
  // real movement still reads through the jitter: a hand shaken fast and wide, a march
  const shake = (t, P) => { const a = 2 * Math.PI * 6 * t; P[16] = [0.41 + 0.03 * Math.sin(a), 0.5 + 0.02 * Math.cos(a)]; };
  assert.equal(run(shake, { jitter: 0.004 }).parts.arm_r.kind, 'shake');
  const march = (t, P) => { for (const [ankle, knee, phase] of [[27, 25, 0], [28, 26, Math.PI]]) { const up = lifted(t, phase); P[ankle][1] -= 0.04 * up; P[knee][1] -= 0.02 * up; } };
  assert.equal(run(march, { jitter: 0.004 }).parts.leg_l.kind, 'step');
}

// The torso: hips against the feet, and the whole body against the home spot.
{
  // hips sway over feet that stay
  const m = run((t, P) => shift(P, 0.08 * Math.sin(Math.PI * t / 2), 0, UPPER));
  assert.equal(m.parts.torso.kind, 'shift', JSON.stringify(m.parts.torso));
}
{
  // the whole body steps side to side
  const m = run((t, P) => shift(P, 0.12 * Math.sin(Math.PI * t / 2), 0));
  assert.equal(m.parts.torso.kind, 'travel');
  assert.equal(m.direction, 'side to side');
}
assert.equal(run((t, P) => shift(P, 0, -0.12 * Math.abs(Math.sin(Math.PI * t / BEAT)))).parts.torso.kind, 'jump');
{
  // crouch: hips and everything above come down, the feet stay
  const m = run((t, P) => shift(P, 0, 0.12 * Math.min(1, t), UPPER));
  assert.equal(m.parts.torso.kind, 'drop');
  assert.equal(m.space.level, 'low');
}

// Space: where the dancer ended up against where they stood at the start.
{
  // walks to their left (image right) by more than a torso length, and stays
  const m = run((t, P) => shift(P, 0.3 * Math.min(1, t / 3), 0));
  assert.equal(m.space.zone, 'left', JSON.stringify(m.space));
  assert.ok(m.space.x > 1 && m.space.width > 1 && m.space.y === 0, JSON.stringify(m.space));
  assert.equal(m.space.weight, 'center', 'the feet came along');
}
{
  // went right, then back to the start: in the centre again, but the space was used
  const m = run((t, P) => shift(P, -0.3 * Math.sin(Math.PI * Math.min(1, t / 6)), 0));
  assert.equal(m.space.zone, 'center');
  assert.ok(m.space.width > 1, JSON.stringify(m.space));
}
assert.equal(run((t, P) => shift(P, 0.07, 0, UPPER)).space.weight, 'left', 'hips over the left foot');
assert.equal(run((t, P) => P.forEach(p => { p[0] = 0.5 + 1.4 * (p[0] - 0.5); p[1] = 0.5 + 1.4 * (p[1] - 0.5); })).space.depth, 'near', 'bigger in the frame: closer to the camera');
{
  // without a still start there is no home spot, so no space; the parts still read
  const c = new MovementLabeler();
  for (let i = 0; i < 240; i++) { const t = i / 30; c.add({ tMs: 1000 * t, image: figure(t, (u, P) => shift(P, 0.12 * Math.sin(Math.PI * u / 2), 0)), visibility: Array(33).fill(1), aspect: 0.75, musicT: null, beatS: null }); }
  assert.equal(c.calibrated, false);
  assert.equal(c.label().space, null);
  assert.equal(c.label().parts.torso.kind, 'travel');
  assert.equal(c.label().timing, null, 'no music: no timing');
}

// Zone shares over time, for the guide's left / right targets.
{
  // 3 s still at home, then walks a torso and a half to their left at once and stays there for 10 s
  const c = runLabeler((t, P) => shift(P, 0.3, 0), { seconds: 10 });
  const z = c.zoneShares(30);
  assert.ok(z.left > 0.5 && Math.abs(z.left + z.center + z.right - 1) < 1e-9, JSON.stringify(z));
  assert.ok(c.zoneShares(4).left > 0.99, 'the last 4 s were all on the left');
  assert.equal(new MovementLabeler().zoneShares(30), null, 'not calibrated: no zones');
  c.reset();
  assert.equal(c.zoneShares(30), null, 'reset forgets the home spot and the zone history');
}
console.log('PASS: movement labels');
