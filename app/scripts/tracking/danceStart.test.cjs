const assert = require('./assert.cjs');
const { nextStart, secondsLeft, IDLE } = require('../load-ts.cjs')('src/tracking/danceStart.ts');

const press = (nowMs, calibrated) => ({ type: 'press', nowMs, calibrated, countdownMs: 5000 });
const tick = (nowMs, state = 'tracking', playing = false) => ({ type: 'tick', nowMs, state, playing });

// not calibrated: countdown -> recalibrate -> wait for the dancer -> play
let r = nextStart(IDLE, press(0, false));
assert.deepEqual(r, { phase: { kind: 'countdown', endsAtMs: 5000, calibrate: true }, actions: [] });
assert.equal(secondsLeft(r.phase, 1200), 4);
assert.deepEqual(nextStart(r.phase, tick(4999)).actions, []);
r = nextStart(r.phase, tick(5000));
assert.deepEqual(r, { phase: { kind: 'calibrating' }, actions: ['recalibrate'] });
assert.deepEqual(nextStart(r.phase, tick(5200, 'waiting')).actions, [], 'waits while nobody is in view');
assert.deepEqual(nextStart(r.phase, tick(6000, 'calibrating')).actions, []);
assert.deepEqual(nextStart(r.phase, tick(8200, 'tracking')), { phase: IDLE, actions: ['play'] });

// already calibrated: countdown -> play
const counting = nextStart(IDLE, press(0, true)).phase;
assert.deepEqual(nextStart(counting, tick(5000)), { phase: IDLE, actions: ['play'] });
// external play cancels: music started from the dock during the countdown, never play twice
assert.deepEqual(nextStart(counting, tick(2000, 'tracking', true)), { phase: IDLE, actions: [] });
assert.deepEqual(nextStart(counting, { type: 'cancel' }), { phase: IDLE, actions: [] });
assert.deepEqual(nextStart(counting, press(100, true)).phase, counting, 'pressing again while counting does nothing');
assert.deepEqual(nextStart(IDLE, tick(100)), { phase: IDLE, actions: [] });
assert.equal(secondsLeft(IDLE, 0), 0);
