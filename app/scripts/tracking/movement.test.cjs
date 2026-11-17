// Movement labels (src/movement/classify.ts): the scripted demo figures are read as the way they move.
const assert = require('./assert.cjs');
const load = require('../load-ts.cjs');
const { MovementClassifier } = load('src/movement/classify.ts');
const { demoFrame } = load('src/tracking/demoMoves.ts');

const BEAT = 0.5;
/** `seconds` of a clip at 30 fps with the music playing (or paused), then its label. */
function run(clip, seconds = 8, playing = true) {
  const c = new MovementClassifier();
  for (let i = 0; i < seconds * 30; i++) {
    const t = i / 30, f = demoFrame(clip, t, playing, BEAT);
    c.add({ tMs: 1000 * t, image: f.image.map(p => [p.x, p.y]), visibility: f.image.map(p => p.visibility), aspect: 0.75, musicT: playing ? t : null, beatS: playing ? BEAT : null });
  }
  return c.label();
}
if (process.env.MOVEMENT_PRINT) for (const clip of ['still', 'reach', 'circle', 'jump', 'low', 'step', 'spin', 'combo']) console.log(clip, JSON.stringify(run(clip)));

assert.equal(new MovementClassifier().label(), null, 'no frames: no label');
assert.deepEqual(run('still'), { speed: 'still', size: 'small', direction: 'in place', texture: null, lead: null, timing: null });
assert.deepEqual(run('jump', 8, false), run('still'), 'paused: the figure stands');
{
  const m = run('reach');
  assert.ok(m.speed !== 'still' && m.size !== 'small', JSON.stringify(m));
  assert.ok(m.lead === 'arm_l' || m.lead === 'arm_r', `reach is led by an arm: ${m.lead}`);
  assert.equal(m.direction, 'in place');
}
{
  const m = run('circle');
  assert.equal(m.lead, 'arm_r');
  assert.equal(m.texture, 'smooth');
}
assert.equal(run('jump').direction, 'up-down');
assert.equal(run('step').direction, 'side to side');
{
  // a hidden trunk is skipped, a hidden hand keeps its place: neither invents movement
  const c = new MovementClassifier();
  for (let i = 0; i < 90; i++) {
    const f = demoFrame('still', 0, false, BEAT);
    const visibility = f.image.map((p, j) => (i % 2 && (j === 15 || j === 11) ? 0 : 1));
    c.add({ tMs: 33 * i, image: f.image.map(p => [p.x, p.y]), visibility, aspect: 0.75, musicT: null, beatS: null });
  }
  assert.equal(c.label().speed, 'still');
}
console.log('PASS: movement labels for the demo figures');
