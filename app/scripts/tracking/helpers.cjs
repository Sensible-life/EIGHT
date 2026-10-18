// Shared helpers for the tracking tests: id403 tests/posegen.py ported, a seeded RNG, approx checks.
const assert = require('node:assert/strict');
const S = require('../load-ts.cjs')('src/tracking/segments.ts');

const N = 33;

/** Standing figure. Defaults: torso 0.2, hip->ankle 0.4 (leg ratio 2.0). Image coords, y down. */
function standingImage({ hipY = 0.5, shoulderY = 0.3, ankleY = 0.9, noseY = 0.2, wristY = 0.5 } = {}) {
  const lm = Array.from({ length: N }, () => [0.5, 0.5, 0]);
  lm[S.NOSE] = [0.5, noseY, 0];
  lm[S.L_EAR][1] = lm[S.R_EAR][1] = noseY;
  lm[S.L_SHOULDER] = [0.55, shoulderY, 0];
  lm[S.R_SHOULDER] = [0.45, shoulderY, 0];
  lm[S.L_HIP] = [0.53, hipY, 0];
  lm[S.R_HIP] = [0.47, hipY, 0];
  lm[S.L_ELBOW][1] = lm[S.R_ELBOW][1] = (shoulderY + wristY) / 2;
  lm[S.L_WRIST] = [0.6, wristY, 0];
  lm[S.R_WRIST] = [0.4, wristY, 0];
  lm[S.L_KNEE][1] = lm[S.R_KNEE][1] = (hipY + ankleY) / 2;
  for (const i of [S.L_ANKLE, S.R_ANKLE, S.L_FOOT, S.R_FOOT]) lm[i][1] = ankleY;
  return lm;
}

/** Rough metric 3D: hip-centered, ~1.6 m tall figure. */
function worldFromImage(img) {
  const hip = [0, 1, 2].map(k => (img[S.L_HIP][k] + img[S.R_HIP][k]) / 2);
  return img.map(p => p.map((v, k) => (v - hip[k]) * 2));
}

function frame(tMs, image = standingImage(), visibility = Array(N).fill(1)) {
  return { tMs, image, world: worldFromImage(image), visibility };
}

/** Seeded RNG (mulberry32) with a Box-Muller normal. */
function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, normal: (sd = 1) => sd * Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next()) };
}

const jitter = (img, r, sd = 0.002) => img.map(p => p.map(v => v + r.normal(sd)));
const close = (a, b, tol = 1e-9, msg) => assert.ok(Math.abs(a - b) <= tol, msg ?? `${a} != ${b} (tol ${tol})`);

module.exports = { N, S, standingImage, worldFromImage, frame, rng, jitter, close };
