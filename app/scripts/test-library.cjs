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

const motif = { id: 'm1', projectId: 'p1', sessionId: 's1', name: '여덟 박', createdAt: 1, start: 0, end: 4, eightIndex: null, body: perSegment(1 / 6), level: { low: 0, mid: 1, high: 0 } };
const composition = { id: 'c1', projectId: 'p1', name: '연습', motifIds: ['m1', 'm1'], createdAt: 1 };
const stored = { ...empty, projects: [trackedProject], sessions: [trackedSession], extras: { motifs: [motif], compositions: [composition] } };
assert.equal(decodeLibrary(JSON.stringify(stored), empty).extras.compositions[0].motifIds.length, 2);
assert.throws(() => decodeLibrary(JSON.stringify({ ...stored, extras: { ...stored.extras, motifs: [{ ...motif, end: 0 }] } }), empty));
assert.throws(() => decodeLibrary(JSON.stringify({ ...stored, extras: { ...stored.extras, compositions: [{ ...composition, motifIds: ['missing'] }] } }), empty));
console.log('PASS: motifs and compositions round-trip; invalid ranges and references are rejected');
const videoMotif = { ...motif, video: 'file:///app/media/video.mp4', videoOffset: 1.25 };
assert.equal(decodeLibrary(JSON.stringify({ ...stored, extras: { ...stored.extras, motifs: [videoMotif] } }), empty).extras.motifs[0].video, videoMotif.video);
assert.equal(decodeLibrary(JSON.stringify({ ...stored, extras: { ...stored.extras, motifs: [videoMotif] } }), empty).extras.motifs[0].videoOffset, 1.25);
assert.throws(() => decodeLibrary(JSON.stringify({ ...stored, extras: { ...stored.extras, motifs: [{ ...videoMotif, video: 123 }] } }), empty));
assert.throws(() => decodeLibrary(JSON.stringify({ ...stored, extras: { ...stored.extras, motifs: [{ ...videoMotif, videoOffset: -1 }] } }), empty));
console.log('PASS: recorded-video metadata round-trip and validation');

const { placeClip, resizeClip, clipAt } = require('./load-ts.cjs')('src/editor/timeline.ts');
const firstClip = { id: 'v1', motifId: 'm1', start: 1, sourceStart: 0, duration: 2 };
const secondClip = { id: 'v2', motifId: 'm1', start: 4, sourceStart: 0, duration: 2 };
assert.equal(placeClip([firstClip], secondClip, 2, 10).start, 3, 'dragging near another clip snaps to a free position');
assert.equal(placeClip([firstClip], secondClip, 9, 10).start, 8, 'clips stay inside the music');
assert.equal(resizeClip([firstClip, secondClip], firstClip, 5, 8, 10).duration, 3, 'trimming cannot overlap the next clip');
assert.equal(clipAt([firstClip, secondClip], 4.5).id, 'v2');
assert.equal(clipAt([firstClip, secondClip], 3.5), undefined, 'gaps contain no video');
const timeline = { id: 'draft1', projectId: 'p1', name: 'Draft', updatedAt: 1, clips: [firstClip, secondClip] };
const finished = { id: 'f1', projectId: 'p1', name: 'Final', createdAt: 1, clips: [firstClip], video: 'file:///app/media/final.mp4' };
const withTimeline = { ...stored, extras: { ...stored.extras, motifs: [videoMotif], timelines: [timeline], finished: [finished] } };
assert.equal(decodeLibrary(JSON.stringify(withTimeline), empty).extras.finished[0].video, finished.video);
assert.equal(decodeLibrary(JSON.stringify(withTimeline), empty).extras.timelines[0].clips.length, 2);
assert.throws(() => decodeLibrary(JSON.stringify({ ...withTimeline, extras: { ...withTimeline.extras, timelines: [{ ...timeline, clips: [firstClip, { ...secondClip, start: 2 }] }] } }), empty), 'overlaps are rejected');
assert.throws(() => decodeLibrary(JSON.stringify({ ...withTimeline, extras: { ...withTimeline.extras, finished: [{ ...finished, video: 123 }] } }), empty), 'finished media must be a file path');
console.log('PASS: timeline positioning, trimming, persistence and completed MP4 validation');

const { focusSummary, selectSessions } = require('./load-ts.cjs')('src/analysis/summary.ts');
const focusTimeline = { ...timeline, clips: [{ ...firstClip, focusLayers: ['drums', 'bass'] }, secondClip] };
const summary = focusSummary([focusTimeline], 'p1');
assert.equal(summary.totalClips, 2);
assert.equal(summary.taggedClips, 1);
assert.equal(summary.layers.find(layer => layer.stem === 'drums').clips, 1);
assert.equal(summary.layers.find(layer => layer.stem === 'bass').seconds, 2);
assert.equal(focusSummary([focusTimeline], 'different').totalClips, 0);
assert.deepEqual(Array.from(selectSessions([{ id: 'old', projectId: 'p1', startedAt: 5 }, { id: 'new', projectId: 'p1', startedAt: 15 }, { id: 'other', projectId: 'p2', startedAt: 20 }], 'p1', 10), item => item.id), ['new']);
const taggedStored = { ...withTimeline, extras: { ...withTimeline.extras, timelines: [focusTimeline] } };
assert.equal(decodeLibrary(JSON.stringify(taggedStored), empty).extras.timelines[0].clips[0].focusLayers[0], 'drums');
assert.throws(() => decodeLibrary(JSON.stringify({ ...taggedStored, extras: { ...taggedStored.extras, timelines: [{ ...focusTimeline, clips: [{ ...firstClip, focusLayers: ['bass', 'bass'] }] }] } }), empty));
console.log('PASS: project and period filtering, explicit focus-layer counts and persistence');
