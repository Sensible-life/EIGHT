// Demo input (src/tracking/demoMoves.ts): scripted figures that stand in for the camera when trying the app
// without one. Each clip, fed through the real store the way the browser camera feeds it, is seen as its move.
const assert = require('./assert.cjs');
const load = require('../load-ts.cjs');
const { DEMO_CLIPS, demoFrame } = load('src/tracking/demoMoves.ts');
const { webPoseEvent } = load('src/tracking/webEvent.ts');
const { LiveTrackingStore } = load('src/tracking/store.ts');
const { DEFAULT_CONFIG } = load('src/tracking/config.ts');

assert.deepEqual(DEMO_CLIPS.map(c => c.id), ['still', 'reach', 'circle', 'jump', 'low', 'step', 'spin', 'combo']);
assert.ok(DEMO_CLIPS.every(c => typeof c.label === 'string' && c.label.length > 0));

const BEAT = 0.5;
/** 4 s standing with the music paused (calibration), then `seconds` of the clip recorded with the music playing. */
function run(clip, seconds = 16) {
  let t = 0, wall = 1_000_000, seq = 0;
  const music = { position: 0, playing: false };
  const store = new LiveTrackingStore(DEFAULT_CONFIG, { wallNowMs: () => wall, perfNowMs: () => 0 });
  store.setMusicSource(() => music);
  const send = () => {
    const f = demoFrame(clip, music.position, music.playing, BEAT);
    store.handlePose(webPoseEvent({ tMs: t, seq: ++seq, nowMs: t, wallMs: wall, latencyMs: 0, aspect: 0.75, image: f.image, world: f.world }));
    t += 33; wall += 33;
    if (music.playing) music.position += 0.033;
  };
  for (let i = 0; i < 120; i++) send();
  assert.equal(store.trackerState, 'tracking', `${clip}: calibrated on the standing figure`);
  store.beginTake(); // movement counts only while recording
  music.playing = true;
  for (let i = 0; i < seconds * 30; i++) send();
  return store.session.exportTracking().moves;
}
const sides = o => o.l + o.r;
const reaches = m => ['l', 'r'].reduce((n, s) => n + m.reach[s].up + m.reach[s].side + m.reach[s].down, 0);

{
  const f = demoFrame('reach', 1, true, BEAT);
  assert.equal(f.image.length, 33);
  assert.equal(f.world.length, 33);
  assert.ok(f.image.every(p => p.visibility === 1 && Number.isFinite(p.x) && Number.isFinite(p.y)));
  assert.deepEqual(demoFrame('jump', 3.3, false, BEAT), demoFrame('still', 0, false, BEAT), 'paused: every clip stands still');
  assert.deepEqual(demoFrame('nope', 1, true, BEAT), demoFrame('still', 1, true, BEAT), 'an unknown clip stands still');
}
{
  const m = run('still');
  assert.equal(reaches(m) + m.clap + sides(m.circle) + m.turnHalves + m.jump + m.low + sides(m.travel) + sides(m.lean), 0, 'still: nothing');
}
{
  const m = run('reach');
  assert.ok(m.reach.l.up >= 2, `reach: left up ${m.reach.l.up}`);
  assert.ok(m.reach.r.side >= 2, `reach: right side ${m.reach.r.side}`);
  assert.equal(m.jump + m.low + m.turnHalves, 0);
}
assert.ok(run('circle').circle.r >= 4, 'circle');
{
  const m = run('jump');
  assert.ok(m.jump >= 8, `jump ${m.jump}`);
  assert.equal(m.low, 0);
}
assert.ok(run('low').low >= 2, 'low');
{
  const m = run('step');
  assert.ok(m.travel.l >= 2 && m.travel.r >= 2, `step ${m.travel.l} / ${m.travel.r}`);
}
assert.ok(run('spin').turnHalves >= 4, 'spin');
{
  const m = run('combo', 32); // two rounds of its four 8-counts
  assert.ok(reaches(m) >= 2 && m.jump >= 2 && m.low >= 1 && sides(m.travel) >= 2, `combo ${JSON.stringify({ reach: reaches(m), jump: m.jump, low: m.low, travel: m.travel })}`);
}
