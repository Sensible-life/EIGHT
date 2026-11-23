// Movement labels (src/tracking/labels.ts): scripted figures are read as the way they move.
// Moved from server/tests/movement.test.mjs when the webcam labels joined the tracking code.
const assert = require('./assert.cjs');
const { MovementLabeler } = require('../load-ts.cjs')('src/tracking/labels.ts');

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
function runLabeler(pose, { seconds = 8, music = true, hide = () => [] } = {}) {
  const c = new MovementLabeler();
  for (let i = 0; i < (STILL + seconds) * 30; i++) {
    const t = i / 30, hidden = hide(i);
    c.add({ tMs: 1000 * t, image: figure(t - STILL, t >= STILL ? pose : null), visibility: Array.from({ length: 33 }, (_, j) => (hidden.includes(j) ? 0 : 1)), aspect: 0.75, musicT: music ? t : null, beatS: music ? BEAT : null });
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
