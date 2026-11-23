// Saying yes without hands (src/tracking/answer.ts): both arms make an O over the head for 3 s, only while asked.
const assert = require('./assert.cjs');
const load = require('../load-ts.cjs');
const { isOverheadO, OverheadAnswer } = load('src/tracking/answer.ts');
const { DEFAULT_CONFIG } = load('src/tracking/config.ts');
const { standingImage, frame } = require('./helpers.cjs');

const CFG = DEFAULT_CONFIG.answer, ASPECT = 0.75;
/** Standing figure (nose 0.2, shoulders 0.3, hips 0.5: torso 0.2) with the given wrists and elbows (image coords, x to the dancer's left). */
function arms(wl, wr, el, er) {
  const img = standingImage();
  img[15] = [...wl, 0]; img[16] = [...wr, 0]; img[13] = [...el, 0]; img[14] = [...er, 0];
  return img;
}
const O = arms([0.51, 0.08], [0.49, 0.08], [0.62, 0.18], [0.38, 0.18]);
const ARMS_UP_APART = arms([0.6, 0.05], [0.4, 0.05], [0.58, 0.17], [0.42, 0.17]);
const CLAP_AT_CHEST = arms([0.51, 0.4], [0.49, 0.4], [0.6, 0.38], [0.4, 0.38]);
const circles = tMs => { const a = 2 * Math.PI * tMs / 1500, c = Math.cos(a), s = Math.sin(a); return arms([0.55 + 0.2 * c, 0.3 + 0.2 * s], [0.45 - 0.2 * c, 0.3 + 0.2 * s], [0.55 + 0.1 * c, 0.3 + 0.1 * s], [0.45 - 0.1 * c, 0.3 + 0.1 * s]); };
const poseOf = (kind, tMs) => frame(tMs, kind === 'O' ? O : kind === 'circles' ? circles(tMs) : standingImage());

/** Segments [kind, seconds] at 30 fps ('none' = nobody in view); the last argument may be { asking }. */
function feed(...args) {
  const opts = Array.isArray(args[args.length - 1]) ? { asking: true } : args.pop();
  const answer = new OverheadAnswer(CFG);
  let n = 0, yesAt = null, yesCount = 0, maxProgress = 0;
  for (const [kind, seconds] of args) {
    for (let i = 0; i < Math.round(seconds * 30); i++, n++) {
      const tMs = n * 100 / 3;
      const r = answer.update(kind === 'none' ? null : poseOf(kind, tMs), ASPECT, opts.asking, tMs);
      maxProgress = Math.max(maxProgress, r.progress);
      if (r.yes) { yesCount++; if (yesAt === null) yesAt = tMs; }
    }
  }
  return { yesAt, yesCount, maxProgress };
}

assert.equal(isOverheadO(frame(0, O), ASPECT, CFG), true, 'O over the head');
assert.equal(isOverheadO(frame(0, ARMS_UP_APART), ASPECT, CFG), false, 'arms straight up, hands apart');
assert.equal(isOverheadO(frame(0, CLAP_AT_CHEST), ASPECT, CFG), false, 'hands together at the chest');
assert.equal(isOverheadO(frame(0, standingImage()), ASPECT, CFG), false, 'standing');
{
  const hidden = frame(0, O, Array.from({ length: 33 }, (_, i) => (i === 15 ? 0.2 : 1)));
  assert.equal(isOverheadO(hidden, ASPECT, CFG), false, 'a hand not seen is not an O');
}

{
  const r = feed(['stand', 1], ['O', 3.05], { asking: true });
  assert.equal(r.yesAt, 1000 + 3000, 'held 3 s while asking: yes, exactly at 3 s');
  assert.equal(r.maxProgress, 1);
}
{
  const r = feed(['stand', 1], ['O', 2.5], { asking: true });
  assert.equal(r.yesAt, null, '2.5 s is not enough');
  assert.ok(r.maxProgress > 0.8 && r.maxProgress < 1, `progress shows the hold: ${r.maxProgress}`);
}
assert.equal(feed(['O', 5], { asking: true }).yesAt, null, 'an O made before the question does not count');
assert.equal(feed(['stand', 1], ['O', 3.05], { asking: false }).yesAt, null, 'not asking: no answer');
assert.equal(feed(['stand', 1], ['O', 7], { asking: true }).yesCount, 1, 'holding on does not answer twice');
assert.equal(feed(['stand', 1], ['O', 7], ['stand', 0.5], ['O', 3.05], { asking: true }).yesCount, 2, 'arms down and up again: a new answer');
assert.equal(feed(['stand', 1], ['O', 2], ['none', 0.1], ['O', 2], { asking: true }).yesAt, null, 'null pose resets the hold');
assert.equal(feed(['stand', 1], ['circles', 6], { asking: true }).yesAt, null, 'arm circles are not an answer');
{
  const a = new OverheadAnswer(CFG);
  a.update(frame(0, standingImage()), ASPECT, true, 0);
  a.update(frame(100, O), ASPECT, true, 100);
  assert.deepEqual(a.update(frame(200, O), ASPECT, false, 200), { progress: 0, yes: false }, 'the question went away: the hold is gone');
}
console.log('PASS: overhead O answer');
