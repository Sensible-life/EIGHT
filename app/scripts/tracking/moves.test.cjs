// Move and space detection (src/tracking/moves.ts) on scripted stick figures, plus saving, insights and validation.
const assert = require('./assert.cjs');
const load = require('../load-ts.cjs');
const { MoveDetector, emptyMoves, mergeMoves } = load('src/tracking/moves.ts');
const { DEFAULT_CONFIG, withConfig } = load('src/tracking/config.ts');
const { LiveSession } = load('src/tracking/session.ts');
const { moveInsights } = load('src/tracking/insights.ts');
const { validTracking, validMoves } = load('src/tracking/validate.ts');
const S = load('src/tracking/segments.ts');
const { frame } = require('./helpers.cjs');

const FPS = 30, ASPECT = 0.75, T = 0.15; // portrait 4:3 frame; torso length in frame heights

/** Standing figure facing the camera, in square units (x * aspect, y). The dancer's left is at larger x. */
function stand({ hx = 0.375, hy = 0.55 } = {}) {
  const P = Array.from({ length: 33 }, () => [hx, hy]);
  P[S.NOSE] = [hx, hy - 1.5 * T];
  P[S.L_EAR] = [hx + 0.02, hy - 1.5 * T];
  P[S.R_EAR] = [hx - 0.02, hy - 1.5 * T];
  P[S.L_SHOULDER] = [hx + 0.4 * T, hy - T];
  P[S.R_SHOULDER] = [hx - 0.4 * T, hy - T];
  P[S.L_HIP] = [hx + 0.25 * T, hy];
  P[S.R_HIP] = [hx - 0.25 * T, hy];
  P[S.L_ELBOW] = [hx + 0.45 * T, hy - 0.5 * T];
  P[S.R_ELBOW] = [hx - 0.45 * T, hy - 0.5 * T];
  P[S.L_WRIST] = [hx + 0.47 * T, hy - 0.05 * T];
  P[S.R_WRIST] = [hx - 0.47 * T, hy - 0.05 * T];
  P[S.L_KNEE] = [hx + 0.25 * T, hy + T];
  P[S.R_KNEE] = [hx - 0.25 * T, hy + T];
  for (const [i, x] of [[S.L_ANKLE, 0.25], [S.L_FOOT, 0.25], [S.R_ANKLE, -0.25], [S.R_FOOT, -0.25]]) P[i] = [hx + x * T, hy + 2 * T];
  return P;
}
/** P.hidden: landmarks the pose model can't see in this frame. */
const pose = (tMs, P) => ({
  tMs, image: P.map(([x, y]) => [x / ASPECT, y, 0]), world: P.map(() => [0, 0, 0]), visibility: P.map((_, i) => (P.hidden?.includes(i) ? 0 : 1)),
});
/** Arm straight from the shoulder, `deg` from hanging down (180 = straight up). */
function arm(P, side, deg, len = 0.95 * T) {
  const [a, e, w] = side === 'l' ? [S.L_SHOULDER, S.L_ELBOW, S.L_WRIST] : [S.R_SHOULDER, S.R_ELBOW, S.R_WRIST];
  const sx = side === 'l' ? 1 : -1, r = (deg * Math.PI) / 180, v = [sx * Math.sin(r), Math.cos(r)];
  P[e] = [P[a][0] + (v[0] * len) / 2, P[a][1] + (v[1] * len) / 2];
  P[w] = [P[a][0] + v[0] * len, P[a][1] + v[1] * len];
  return P;
}

/** Calibrate on a standing figure, play `move(tS)` for `seconds`, settle standing; returns the totals. */
function run(move, seconds, { counting = true, cfg = DEFAULT_CONFIG } = {}) {
  const d = new MoveDetector(cfg);
  let t = 0;
  const feed = (P, phase, count) => {
    d.update(Math.round(t), P && pose(Math.round(t), P), ASPECT, phase, count);
    t += 1000 / FPS;
  };
  for (let i = 0; i < 2 * FPS; i++) feed(stand(), 'calibrating', false);
  for (let i = 0; i < seconds * FPS; i++) feed(move(i / FPS), 'tracking', counting);
  for (let i = 0; i < FPS; i++) feed(stand(), 'tracking', counting);
  return d.exportTotals();
}
const counts = m => ({
  reach: m.reach, clap: m.clap, circle: m.circle, lift: m.lift, turnHalves: m.turnHalves,
  jump: m.jump, low: m.low, travel: m.travel, lean: m.lean,
});
const none = counts(emptyMoves());
/** Only `expected` differs from no moves at all. */
function only(m, expected, name) {
  const want = mergeMoves(emptyMoves(), emptyMoves());
  for (const [k, v] of Object.entries(expected)) want[k] = typeof v === 'object' ? { ...want[k], ...v } : v;
  assert.deepEqual(counts(m), counts(want), name);
}

// standing still: nothing, and all the space time sits in the middle cell
{
  const m = run(() => stand(), 3);
  assert.deepEqual(counts(m), none, 'still');
  assert.ok(m.spaceMs[4] > 3500 && m.spaceMs.every((v, i) => i === 4 || v === 0), `still space ${m.spaceMs}`);
}
// arm reaches, by direction and side (the dancer's own left / right)
only(run(t => arm(stand(), 'l', Math.min(175, 10 + t * 300)), 2), { reach: { l: { up: 1, side: 0, down: 0 } } }, 'reach up left');
only(run(t => arm(stand(), 'r', Math.min(90, 10 + t * 200)), 2), { reach: { r: { up: 0, side: 1, down: 0 } } }, 'reach side right');
only(run(t => arm(stand(), 'l', Math.min(50, 10 + t * 100)), 2), { reach: { l: { up: 0, side: 0, down: 1 } } }, 'reach down left');
// a held reach counts once; a brief wobble below the threshold does not split it
only(run(t => arm(stand(), 'r', 90, t > 1 && t < 1.1 ? 0.88 * T : 0.95 * T), 3), { reach: { r: { up: 0, side: 1, down: 0 } } }, 'reach held with a wobble');
// hands together, three times
only(run(t => {
  const P = stand(), open = (Math.sin(t * 2 * Math.PI) + 1) / 2;
  P[S.L_WRIST] = [0.375 + 0.01 + 0.06 * open, 0.42];
  P[S.R_WRIST] = [0.375 - 0.01 - 0.06 * open, 0.42];
  return P;
}, 3), { clap: 3 }, 'hands together');
// two arm circles: counted as circles, not as reaches
only(run(t => arm(stand(), 'r', (t * 360 * 0.8) % 360), 2.6), { circle: { l: 0, r: 2 } }, 'arm circles');
// a leg lift, big; a jump lifts both feet and is not a leg lift
only(run(t => {
  const P = stand(), k = Math.sin(Math.min(t, 1) * Math.PI);
  P[S.L_ANKLE] = [P[S.L_ANKLE][0] + 0.3 * T * k, P[S.L_ANKLE][1] - 0.9 * T * k];
  return P;
}, 1.5), { lift: { l: { small: 0, big: 1 } } }, 'leg lift');
only(run(t => stand({ hy: 0.55 - 0.4 * T * Math.max(0, Math.sin(Math.min(t, 0.5) * 2 * Math.PI)) }), 1), { jump: 1 }, 'jump');
// a full spin where the pose model never sees the back: two quick shoulder-width dips
only(run(t => {
  const P = stand(), half = 0.4 * T * Math.cos(2 * Math.PI * Math.min(t / 1.2, 1));
  P[S.L_SHOULDER] = [0.375 + half, 0.55 - T];
  P[S.R_SHOULDER] = [0.375 - half, 0.55 - T];
  return P;
}, 1.5), { turnHalves: 2 }, 'spin');
// a half turn to the back and back again: the face disappears, the shoulders narrow on the way (labels kept)
only(run(t => {
  const P = stand(), w = Math.abs(Math.cos(Math.PI * Math.min(t / 1.6, 1) * 2)); // 1 -> 0 -> 1 (back) -> 0 -> 1
  P[S.L_SHOULDER] = [0.375 + 0.4 * T * w, 0.55 - T];
  P[S.R_SHOULDER] = [0.375 - 0.4 * T * w, 0.55 - T];
  if (t > 0.4 && t < 1.2) P.hidden = [S.NOSE];
  return P;
}, 2), { turnHalves: 2 }, 'turn to the back and return');
// the same with the pose model swapping the shoulder labels on the back
only(run(t => {
  const P = stand(), half = 0.4 * T * Math.cos(Math.PI * Math.min(t / 0.6, 1) + Math.PI * Math.max(0, Math.min((t - 1) / 0.6, 1)));
  P[S.L_SHOULDER] = [0.375 + half, 0.55 - T];
  P[S.R_SHOULDER] = [0.375 - half, 0.55 - T];
  return P;
}, 2), { turnHalves: 2 }, 'turn to the back (labels swapped) and return');
// going low, a side step, a lean
only(run(t => {
  const P = stand(), k = 0.6 * T * Math.sin((Math.min(t, 1.5) / 1.5) * Math.PI);
  for (const i of [S.NOSE, S.L_SHOULDER, S.R_SHOULDER, S.L_ELBOW, S.R_ELBOW, S.L_WRIST, S.R_WRIST, S.L_HIP, S.R_HIP]) P[i] = [P[i][0], P[i][1] + k];
  return P;
}, 2), { low: 1 }, 'going low');
{
  const m = run(t => stand({ hx: 0.375 + Math.min(t, 1) * 1.2 * T }), 1.5);
  only(m, { travel: { l: 1, r: 0 } }, 'side step to the dancer\'s left');
  assert.ok(m.spaceMs[3] > 0, 'time in the mid-left cell');
}
only(run(t => {
  const P = stand(), k = 0.45 * T * Math.sin((Math.min(t, 1.2) / 1.2) * Math.PI);
  for (const i of [S.NOSE, S.L_SHOULDER, S.R_SHOULDER, S.L_ELBOW, S.R_ELBOW, S.L_WRIST, S.R_WRIST]) P[i] = [P[i][0] - k, P[i][1]];
  return P;
}, 1.5), { lean: { l: 0, r: 1 } }, 'lean to the dancer\'s right');
// walking up to the phone (the figure grows) is not a jump, a low or a side step
only(run(t => {
  const g = 1 + Math.min(t, 1);
  return stand().map(([x, y]) => [0.375 + (x - 0.375) * g, 0.4 + (y - 0.4) * g]);
}, 1.5), {}, 'walking toward the camera');
// nothing counts while the music is paused
assert.deepEqual(counts(run(t => arm(stand(), 'l', Math.min(175, 10 + t * 300)), 2, { counting: false })), none, 'paused');

// saved with the session: export / import, reset, recalibrate keeps totals
{
  const cfg = withConfig({ calibration: { duration_s: 1 } });
  const s = new LiveSession(cfg, () => {}, { clockMs: () => 0 });
  let t = 0;
  for (; t <= 2000; t += 33) s.step(t, frame(t), 0.75, { playing: true, musicT: t / 1000 });
  const saved = s.exportTracking();
  assert.ok(saved.moves && saved.moves.spaceMs.reduce((a, b) => a + b, 0) > 0, 'space time counted while playing');
  assert.equal(validTracking(saved), true, 'a fresh export is valid');
  s.recalibrate();
  assert.deepEqual(s.exportTracking().moves, saved.moves, 'recalibrate keeps the moves');
  const resumed = new LiveSession(cfg, () => {}, { clockMs: () => 0 });
  resumed.importTracking(saved);
  assert.deepEqual(resumed.exportTracking().moves, saved.moves, 'resume continues the moves');
  resumed.reset();
  assert.equal(resumed.exportTracking().moves, undefined, 'reset forgets them');
  const old = new LiveSession(cfg, () => {}, { clockMs: () => 0 });
  old.importTracking({ version: 1, trackedMs: 1000, totals: saved.totals }); // saved before moves existed
  assert.equal(old.exportTracking().moves, undefined, 'an older save stays without moves until something is counted');
  for (let u = 0; u <= 2000; u += 33) old.step(u, frame(u), 0.75, { playing: true, musicT: u / 1000 });
  assert.ok(old.exportTracking().moves, 'then they start');
}

// analysis tab: sums sessions tracked >= 30 s that have moves
{
  const totals = { frames: 0, score: {}, observed: {}, levels: {} };
  const m = { ...emptyMoves(), clap: 2, turnHalves: 1 };
  const got = moveInsights([
    { version: 1, trackedMs: 40000, totals, moves: m },
    { version: 1, trackedMs: 60000, totals, moves: { ...m, clap: 5 } },
    { version: 1, trackedMs: 10000, totals, moves: m }, // too short
    { version: 1, trackedMs: 90000, totals }, // an older save without moves
    undefined,
  ]);
  assert.equal(got.sessions, 2);
  assert.equal(got.trackedMs, 100000);
  assert.equal(got.moves.clap, 7);
  assert.equal(got.moves.turnHalves, 2);
  assert.equal(moveInsights([{ version: 1, trackedMs: 90000, totals }]), null);
}

// validation of saved moves
{
  const good = emptyMoves();
  assert.equal(validMoves(good), true);
  const bad = [
    null, [], { ...good, extra: 1 }, { ...good, clap: -1 }, { ...good, clap: Infinity }, { ...good, spaceMs: [1, 2] },
    { ...good, spaceMs: [...good.spaceMs.slice(0, 8), -1] }, { ...good, reach: { l: good.reach.l } },
    { ...good, reach: { ...good.reach, r: { up: 0, side: 0 } } }, { ...good, lift: { ...good.lift, l: { small: 0, big: '1' } } },
    { ...good, travel: { l: 0, r: 0, c: 0 } },
  ];
  bad.forEach((b, i) => assert.equal(validMoves(b), false, `bad moves #${i}`));
  const seg = v => ({ head: v, torso: v, arm_l: v, arm_r: v, leg_l: v, leg_r: v });
  const tracking = { version: 1, trackedMs: 40000, totals: { frames: 10, score: seg(1), observed: seg(10), levels: { low: 0, mid: 10, high: 0 } } };
  assert.equal(validTracking(tracking), true, 'older saves without moves stay valid');
  assert.equal(validTracking({ ...tracking, moves: good }), true);
  assert.equal(validTracking({ ...tracking, moves: { ...good, jump: -2 } }), false);
}
