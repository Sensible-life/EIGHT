// The browser camera (modules/pose-camera/WebPoseCamera.ts) sends the same PoseEvent as the Android module.
const assert = require('./assert.cjs');
const load = require('../load-ts.cjs');
const { webPoseEvent } = load('src/tracking/webEvent.ts');
const { poseFromEvent } = load('src/tracking/store.ts');

const lm = (dx = 0) => Array.from({ length: 33 }, (_, i) => ({ x: 0.1 + dx, y: i / 100, z: -0.5, visibility: 0.9 }));
{
  const e = webPoseEvent({ tMs: 1000, seq: 7, nowMs: 1040, wallMs: 5000, latencyMs: 25, aspect: 4 / 3, image: lm(), world: lm(1) });
  assert.equal(e.tMs, 1000);
  assert.equal(e.seq, 7);
  assert.equal(e.ageMs, 40);
  assert.equal(e.emitWallMs, 5000);
  assert.equal(e.latencyMs, 25);
  assert.equal(e.captureFrom, 'analyzer');
  assert.equal(e.aspect, 4 / 3);
  assert.equal(e.image.length, 99);
  assert.deepEqual(e.image.slice(3, 6), [0.1, 0.01, 0.9], 'image = x, y, visibility');
  assert.deepEqual(e.world.slice(3, 6), [1.1, 0.01, -0.5], 'world = x, y, z');
  const p = poseFromEvent(e);
  assert.equal(p.visibility[32], 0.9);
  assert.deepEqual(p.world[1], [1.1, 0.01, -0.5]);
}
{
  // nobody in view, or a result that is not 33 landmarks: empty arrays, like the Android module
  for (const [image, world] of [[undefined, undefined], [lm(), undefined], [lm().slice(1), lm()]]) {
    const e = webPoseEvent({ tMs: 1, seq: 1, nowMs: 1, wallMs: 1, latencyMs: 0, aspect: 1, image, world });
    assert.deepEqual(e.image, []);
    assert.deepEqual(e.world, []);
    assert.equal(poseFromEvent(e), null);
  }
  // a landmark without a visibility counts as seen
  const bare = lm().map(({ visibility, ...p }) => p);
  assert.equal(webPoseEvent({ tMs: 1, seq: 1, nowMs: 1, wallMs: 1, latencyMs: 0, aspect: 1, image: bare, world: bare }).image[2], 1);
}
