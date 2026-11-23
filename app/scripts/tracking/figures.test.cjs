// Scripted figures (src/tracking/figures.ts): each move on the moves page reads as its word, and the demo's dancer,
// read by the real display tracker, leaves the legs, heights and sides out, answers with an O and tries each target.
const assert = require('./assert.cjs');
const load = require('../load-ts.cjs');
const F = load('src/tracking/figures.ts');
const { DisplayTracker } = load('src/tracking/display.ts');
const { TARGET_ORDER } = load('src/tracking/targets.ts');

// Every word on the moves page is what the labeler (or the O answer) makes of its figure.
assert.equal(new Set(F.MOVES.map(m => m.id)).size, F.MOVES.length, 'move ids are unique');
for (const move of F.MOVES) {
  const r = F.readMove(move);
  if (move.part === 'space') assert.equal(r.space?.zone, move.kind, `${move.id}: ${JSON.stringify(r.space)}`);
  else if (move.part === 'answer') assert.ok(r.yesAfterS !== null && r.yesAfterS >= 3 && r.yesAfterS < 3.5, `${move.id}: yes after ${r.yesAfterS}`);
  else assert.equal(r.part?.kind, move.kind, `${move.id}: ${JSON.stringify(r.part)}`);
  for (const t of [0, 0.37, move.loopS - 0.01]) assert.equal(F.moveFigure(move, t).length, 33, `${move.id} has 33 landmarks`);
}

// The demo's dancer through the display tracker, as the demo page runs it (30 fps, 120 BPM).
{
  const tracker = new DisplayTracker();
  let n = 0, f = null;
  const run = (cue, seconds, asking = false) => {
    const tried = new Set();
    let yes = false;
    for (let i = 0; i < seconds * 30; i++, n++) {
      const tMs = n * 1000 / 30;
      f = tracker.step(F.figureEvent(tMs, n, F.demoFigure(cue, i / 30)), { musicT: tMs / 1000, beatS: F.BEAT_S, playing: true, asking });
      for (const x of f.packet.explored ?? []) tried.add(x);
      yes ||= f.answer.yes;
    }
    return { tried, yes };
  };
  run('still', 4);
  assert.equal(f.status?.state, 'tracking', 'the still start calibrates');
  run('dance', 30);
  const body = f.packet.body;
  assert.ok(body && body.upper > 0.9, JSON.stringify(body));
  for (const t of ['leg_l', 'leg_r', 'low', 'left', 'right']) assert.ok(body.underused.includes(t), `${t} is left out: ${JSON.stringify(body)}`);
  assert.ok(Math.abs(Object.values(body.limbs).reduce((a, b) => a + b, 0) - 1) < 0.01, JSON.stringify(body.limbs));
  assert.ok(body.limbs.arm_l > body.limbs.leg_l && body.limbs.arm_r > body.limbs.leg_r, JSON.stringify(body.limbs));
  assert.equal(f.label.parts.arm_l.kind, 'circle');
  assert.equal(f.label.parts.arm_r.kind, 'reach');
  // asked: it keeps dancing a moment (an O already up would not count), then holds an O
  assert.equal(run('dance', 1.5, true).yes, false);
  assert.equal(run('yes', 4, true).yes, true, 'the O says yes');
  for (const target of TARGET_ORDER) {
    assert.ok(run(target, F.DEMO_TRY_S).tried.has(target), `trying ${target} is seen as trying it`);
    run('dance', 4);
  }
}
console.log('PASS: scripted figures');
