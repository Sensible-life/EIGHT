// The display's frame loop (src/tracking/display.ts): webcam frames in, one relay packet out, read by the same tracking code as the phone.
const assert = require('./assert.cjs');
const load = require('../load-ts.cjs');
const { DisplayTracker, buildPacket } = load('src/tracking/display.ts');
const { DEFAULT_CONFIG } = load('src/tracking/config.ts');
const { standingImage, worldFromImage } = require('./helpers.cjs');

const N = 33, FPS = 30, STAND_S = 4;
const CTX = { musicT: null, beatS: null, playing: true, asking: false };
/** A pose-camera event, as webPoseEvent makes it; image null = nobody in view. */
function eventAt(tMs, image, visibility = Array(N).fill(1)) {
  return {
    tMs, seq: Math.round(tMs / 33), ageMs: 0, emitWallMs: tMs, latencyMs: 0, captureFrom: 'analyzer', aspect: 0.75,
    image: image ? image.flatMap((p, i) => [p[0], p[1], visibility[i]]) : [],
    world: image ? worldFromImage(image).flat() : [],
  };
}
/** Both arms swing out and in; the legs stand. */
const armsOnly = tS => { const img = standingImage(), s = Math.sin(2 * Math.PI * tS); img[15][0] += 0.12 * s; img[13][0] += 0.06 * s; img[16][0] -= 0.12 * s; img[14][0] -= 0.06 * s; return img; };
/** Stands, then an O over the head from 2 s after the calibration on (6 s into the run). */
const oThenHold = tS => {
  const img = standingImage();
  if (tS >= 2) { img[15] = [0.51, 0.08, 0]; img[16] = [0.49, 0.08, 0]; img[13] = [0.62, 0.18, 0]; img[14] = [0.38, 0.18, 0]; }
  return img;
};
/** STAND_S standing still (calibration), then `move` for the rest of `seconds`. `hide` joints are hidden while moving. */
function runDisplay(move, seconds, { hide = [], asking = false } = {}) {
  const tracker = new DisplayTracker();
  let last = null, sawYes = false;
  for (let n = 0; n < seconds * FPS; n++) {
    const tMs = n * 1000 / FPS, tS = tMs / 1000, moving = tS >= STAND_S;
    const vis = Array.from({ length: N }, (_, i) => (moving && hide.includes(i) ? 0 : 1));
    last = tracker.step(eventAt(tMs, moving ? move(tS - STAND_S) : standingImage(), vis), { ...CTX, asking });
    sawYes ||= last.answer.yes;
  }
  return { ...last, sawYes };
}

{
  // arms only for 40 s: the legs are lacking, the packet carries the words and the rings
  const f = runDisplay(armsOnly, STAND_S + 40);
  assert.equal(f.packet.active, true);
  assert.equal(f.packet.source, 'webcam');
  assert.equal(f.status.state, 'tracking');
  assert.ok(f.packet.body.upper > 0.6, JSON.stringify(f.packet.body));
  assert.ok(f.packet.body.underused.includes('leg_l') && f.packet.body.underused.includes('leg_r'), JSON.stringify(f.packet.body));
  assert.deepEqual(f.lacking, f.packet.body.underused);
  assert.ok(f.packet.parts && f.packet.movement && f.packet.space && f.packet.cells.length === 64);
  assert.equal(f.packet.explored.includes('leg_l'), false, 'still legs were not tried');
  assert.ok(f.pose && f.pose.lm.length === N, 'a pose to draw');
  assert.ok(JSON.stringify(f.packet).length < 4096, 'fits the relay limit');
}
{
  // legs that are out of frame (knees and feet hidden while dancing) are not lacking
  const g = runDisplay(armsOnly, STAND_S + 40, { hide: [25, 26, 27, 28, 29, 30, 31, 32] });
  assert.equal(g.packet.active, true, 'still tracking the upper body');
  assert.ok(!g.packet.body.underused.some(t => t === 'leg_l' || t === 'leg_r'), JSON.stringify(g.packet.body));
  assert.equal(g.packet.parts.leg_l.kind, null, 'the hidden leg is unknown');
}
{
  // time going back (a looped video) starts over: calibrate again
  const t = new DisplayTracker();
  for (let n = 0; n < 8 * FPS; n++) t.step(eventAt(n * 1000 / FPS, standingImage()), CTX);
  const back = t.step(eventAt(1000, standingImage()), CTX);
  assert.equal(back.packet.active, false);
  assert.notEqual(back.status?.state, 'tracking');
}
{
  // the O answer counts only while asking; holding it shows in the packet
  const h = runDisplay(oThenHold, 13, { asking: true });
  assert.equal(h.sawYes, true);
  assert.equal(runDisplay(oThenHold, 13, { asking: false }).sawYes, false);
  const mid = runDisplay(oThenHold, 9, { asking: true });
  assert.equal(mid.packet.answering, true, 'holding the O, not yet 3 s');
  assert.ok(mid.answer.progress > 0.5 && mid.answer.progress < 1);
}
// nobody in view: no words, no body
assert.deepEqual(Object.keys(new DisplayTracker().step(eventAt(0, null), CTX).packet).sort(), ['active', 'calibrated', 'cells', 'source']);
// the phone builds the same packet from its own parts
{
  const p = buildPacket({ source: 'phone', active: false, cells: Array(64).fill(0), label: null, usage: {}, zones30: null, zones8: null, answering: false }, DEFAULT_CONFIG);
  assert.deepEqual(p, { active: false, calibrated: false, cells: Array(64).fill(0), source: 'phone' });
}
console.log('PASS: display frame loop');
