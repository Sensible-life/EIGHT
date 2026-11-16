import type { Library } from './model';
import { defaultExtras } from './extras';
import { analyzeTrace, parseTrace } from '../motion/analyze';
import { SEGMENT_NAMES, LEVELS } from '../tracking/segments';
import { validTracking } from '../tracking/validate';
import { clipEnd } from '../editor/timeline';

const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length <= 10000;
const num = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
const list = (v: unknown, check: (item: any) => boolean, max = 10000): boolean => Array.isArray(v) && v.length <= max && v.every(check);
const record = (v: unknown, check: (item: any) => boolean): boolean => object(v) && Object.keys(v).length <= 100 && Object.entries(v).every(([k, value]) => !['__proto__', 'constructor', 'prototype'].includes(k) && check(value));
function requireValid(ok: boolean) { if (!ok) throw new Error("The backup is missing required data or has an invalid format."); }

// Used for disk reads as well as external backups. Recompute derived motion metrics.
export function validateLibrary(raw: string, fallback: Library): Library {
  requireValid(raw.length <= 30_000_000);
  const x = JSON.parse(raw);
  requireValid(object(x) && x.version === 1 && text(x.server));
  requireValid(list(x.projects, p => object(p) && text(p.id) && text(p.server) && typeof p.saved === 'boolean' && num(p.updatedAt) && object(p.job)
    && text(p.job.id) && text(p.job.name) && ['queued','loading','separating','analyzing','encoding','done','error'].includes(p.job.status)
    && text(p.job.stage) && num(p.job.progress) && num(p.job.createdAt) && object(p.job.config) && text(p.job.config.model)
    && num(p.job.config.shifts) && num(p.job.config.overlap) && (p.job.stems === undefined || list(p.job.stems, text, 20))
    && (p.job.files === undefined || record(p.job.files, text)) && (p.remoteFiles === undefined || record(p.remoteFiles, text))
    && (p.job.tempo === undefined || num(p.job.tempo)) && (p.cached === undefined || typeof p.cached === 'boolean')));
  const ids = new Set(x.projects.map((p: any) => p.id));
  requireValid(ids.size === x.projects.length);
  requireValid(list(x.sessions, s => object(s) && text(s.id) && ids.has(s.projectId) && num(s.startedAt) && (s.endedAt === undefined || num(s.endedAt))
    && num(s.position) && num(s.duration) && num(s.listened) && num(s.master, 1.5) && record(s.layerSeconds, num) && (s.playbackRate === undefined || (num(s.playbackRate, 1.5) && s.playbackRate >= 0.5))
    && record(s.mix, m => object(m) && num(m.volume, 1.5) && typeof m.muted === 'boolean' && typeof m.solo === 'boolean')
    && (s.loop === null || (object(s.loop) && num(s.loop.start) && num(s.loop.end) && s.loop.end > s.loop.start && s.loop.end <= s.duration))
    && (s.composition === undefined || (object(s.composition) && list(s.composition.ranges, r => object(r) && num(r.start) && num(r.end) && r.end > r.start && r.end <= s.duration, 100) && s.composition.ranges.length > 0 && num(s.composition.index) && Number.isInteger(s.composition.index) && s.composition.index < s.composition.ranges.length))
    && (s.missionWeek === undefined || text(s.missionWeek)) && (s.missionId === undefined || text(s.missionId)) && (s.missionTitle === undefined || text(s.missionTitle)) && (s.tracking === undefined || validTracking(s.tracking))));
  requireValid(new Set(x.sessions.map((s: any) => s.id)).size === x.sessions.length && list(x.joinedWeeks, text));
  requireValid(x.extras === undefined || object(x.extras));
  const e = { ...defaultExtras(), ...x.extras, watch: { ...defaultExtras().watch, ...x.extras?.watch } };
  requireValid(['bass','kick','both'].includes(e.watch.source) && num(e.watch.threshold, 1) && Number.isFinite(e.watch.offset) && Math.abs(e.watch.offset) <= 300);
  requireValid([1,3,5].includes(e.missionGoal) && list(e.badges, text) && list(e.exploreLiked, text) && list(e.exploreSaved, text));
  requireValid(list(e.posts, p => object(p) && text(p.id) && text(p.author) && text(p.text) && typeof p.sample === 'boolean' && num(p.likes) && typeof p.liked === 'boolean' && list(p.comments, text) && (p.hidden === undefined || typeof p.hidden === 'boolean')));
  requireValid(list(e.motions, m => object(m) && text(m.id) && ids.has(m.projectId) && text(m.name) && num(m.createdAt) && object(m.result) && (m.video === undefined || text(m.video)), 1000));
  const shares = (v: unknown, keys: readonly string[]) => object(v) && Object.keys(v).length === keys.length && keys.every(k => num(v[k], 1));
  requireValid(list(e.motifs, m => object(m) && text(m.id) && ids.has(m.projectId) && text(m.name) && m.name.length > 0 && num(m.createdAt) && num(m.start) && num(m.end) && m.end > m.start
    && (m.sessionId === undefined || text(m.sessionId)) && (m.eightIndex === null || (num(m.eightIndex) && Number.isInteger(m.eightIndex)))
    && (m.body === undefined || shares(m.body, SEGMENT_NAMES)) && (m.level === undefined || shares(m.level, LEVELS))
    && (m.video === undefined || text(m.video)) && (m.videoOffset === undefined || num(m.videoOffset, 60)) && (m.videoRate === undefined || (num(m.videoRate, 1.5) && m.videoRate >= 0.5))
    && (m.mix === undefined || record(m.mix, layer => object(layer) && num(layer.volume, 1.5) && typeof layer.muted === 'boolean' && typeof layer.solo === 'boolean')), 1000));
  requireValid(new Set(e.motifs.map((m: any) => m.id)).size === e.motifs.length);
  const motifMap = new Map<string, any>(e.motifs.map((m: any) => [m.id, m]));
  requireValid(list(e.compositions, c => object(c) && text(c.id) && ids.has(c.projectId) && text(c.name) && num(c.createdAt) && list(c.motifIds, id => text(id) && motifMap.get(id)?.projectId === c.projectId, 100) && c.motifIds.length > 0, 1000));
  requireValid(new Set(e.compositions.map((c: any) => c.id)).size === e.compositions.length);
  const validTimeline = (item: any, isFinished: boolean) => {
    if (!object(item) || !text(item.id) || !ids.has(item.projectId) || !text(item.name) || (isFinished && !item.name.trim())
      || !num(isFinished ? item.createdAt : item.updatedAt) || (isFinished && !text(item.video)) || !list(item.clips, (clip: any) => {
        const motif = motifMap.get(clip?.motifId);
        return object(clip) && text(clip.id) && !!motif && motif.projectId === item.projectId
          && num(clip.start, 86400) && num(clip.sourceStart, 86400) && num(clip.duration, 86400)
          && clip.duration >= 0.1 && clip.sourceStart + clip.duration <= motif.end - motif.start + 0.11
          && (clip.focusLayers === undefined || (list(clip.focusLayers, (layer: any) => text(layer) && layer.length > 0 && layer.length <= 100, 20) && new Set(clip.focusLayers).size === clip.focusLayers.length));
      }, 100) || (isFinished && item.clips.length === 0)) return false;
    const clips = [...item.clips].sort((a: any, b: any) => a.start - b.start);
    return new Set(clips.map((clip: any) => clip.id)).size === clips.length
      && clips.every((clip: any, i: number) => i === 0 || clip.start >= clipEnd(clips[i - 1]) - 0.02);
  };
  requireValid(list(e.timelines, item => validTimeline(item, false), 1000) && new Set(e.timelines.map((x: any) => x.projectId)).size === e.timelines.length);
  requireValid(list(e.finished, item => validTimeline(item, true), 1000) && new Set(e.finished.map((x: any) => x.id)).size === e.finished.length);
  e.motions = e.motions.map((m: any) => {
    const trace = parseTrace(JSON.stringify(m.trace));
    if (m.trace.source === 'sample') trace.source = 'sample';
    return { ...m, sessionId: x.sessions.some((s: any) => s.id === m.sessionId && s.projectId === m.projectId) ? m.sessionId : undefined, trace, result: analyzeTrace(trace, m.result.bpm, m.result.offset) };
  });
  return { ...fallback, version: 1, server: x.server, projects: x.projects, sessions: x.sessions, joinedWeeks: x.joinedWeeks, extras: e };
}
