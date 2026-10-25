const assert = require('node:assert/strict');
const { weekKey, missionProgress, layerShares, projectKey, decodeLibrary } = require('./load-ts.cjs')('src/state/model.ts');
assert.equal(weekKey(new Date(2026, 9, 12)), '2026-10-12');
assert.equal(weekKey(new Date(2026, 9, 18)), '2026-10-12');
assert.equal(weekKey(new Date(2026, 0, 1)), '2025-12-29');
const week = '2026-10-12';
const sessions = [
  { missionWeek: week, endedAt: 100, listened: 30, layerSeconds: { bass: 30, drums: 10 } },
  { missionWeek: week, endedAt: 0, listened: 60, layerSeconds: { bass: 10 } },
  { missionWeek: week, endedAt: 100, listened: 29.9, layerSeconds: {} },
  { missionWeek: '2026-10-05', endedAt: 100, listened: 60, layerSeconds: {} },
  { endedAt: 100, listened: 60, layerSeconds: {} },
];
assert.equal(missionProgress(sessions, week), 1, 'Exclude unfinished, short, previous-week and non-enrolled sessions');
assert.equal(missionProgress(Array(8).fill(sessions[0]), week), 3, 'Cap at the weekly target');
const shares = layerShares(sessions);
assert.equal(shares[0].stem, 'bass'); assert.equal(shares[0].share, .8); assert.equal(shares[1].share, .2);
assert.equal(layerShares([]).length, 0);
const job = { id: 'abc', config: { model: 'lalal' } };
assert.notEqual(projectKey(job, 'http://one'), projectKey(job, 'http://two'));
assert.equal(projectKey(job, 'http://one/'), projectKey(job, 'http://one'));
assert.equal(projectKey({ ...job, config: { model: 'imported' } }, 'http://one'), 'local::abc');
assert.throws(() => decodeLibrary('{invalid}', {}));
assert.throws(() => decodeLibrary('{"version":2}', {}));
console.log('PASS: weekly boundaries, enrollment/completion/duration rules, layer-time shares, project server identity and invalid storage rejection');

const empty = { version: 1, server: 'http://localhost:8000', projects: [], sessions: [], joinedWeeks: [] };
assert.equal(decodeLibrary(JSON.stringify(empty), empty).extras.missionGoal, 3, 'old backups migrate defaults');
assert.throws(() => decodeLibrary(JSON.stringify({ ...empty, projects: [{}] }), empty));
assert.throws(() => decodeLibrary(JSON.stringify({ ...empty, extras: { watch: { source: 'unknown' } } }), empty));
assert.throws(() => decodeLibrary(JSON.stringify({ ...empty, sessions: [{ id: 'orphan' }] }), empty));
assert.throws(() => decodeLibrary(JSON.stringify({ ...empty, extras: { posts: [{}] } }), empty));
assert.equal(missionProgress(Array(8).fill(sessions[0]), week, 5), 5);
console.log('PASS: old-version migration, custom mission goals, malformed nested backup validation');

// Session tracking totals (camera tab): old sessions still load, broken values are rejected.
const trackedProject = { id: 'p1', server: 'local', saved: true, updatedAt: 1, job: { id: 'demo-groove', name: 'demo', status: 'done', stage: 'done', progress: 1, createdAt: 1, config: { model: 'demo', shifts: 0, overlap: 0 } } };
const trackedSession = { id: 's1', projectId: 'p1', startedAt: 1, position: 0, duration: 16, listened: 40, master: 0.8, layerSeconds: {}, mix: {}, loop: null };
const perSegment = v => ({ head: v, torso: v, arm_l: v, arm_r: v, leg_l: v, leg_r: v });
const savedTracking = { version: 1, trackedMs: 40000, totals: { frames: 600, score: perSegment(10), observed: perSegment(600), levels: { low: 0, mid: 600, high: 0 } } };
const withSession = s => JSON.stringify({ ...empty, projects: [trackedProject], sessions: [s] });
assert.equal(decodeLibrary(withSession(trackedSession), empty).sessions[0].tracking, undefined, 'sessions saved before tracking still load');
assert.deepEqual(JSON.parse(JSON.stringify(decodeLibrary(withSession({ ...trackedSession, tracking: savedTracking }), empty).sessions[0].tracking)), savedTracking);
assert.throws(() => decodeLibrary(withSession({ ...trackedSession, tracking: { ...savedTracking, totals: { ...savedTracking.totals, observed: perSegment(601) } } }), empty));
console.log('PASS: session tracking totals load, round-trip and reject broken values');
