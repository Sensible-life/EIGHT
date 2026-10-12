import type { Library } from './model';
import { defaultExtras } from './extras';
import { analyzeTrace, parseTrace } from '../motion/analyze';

const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length <= 10000;
const num = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
const list = (v: unknown, check: (item: any) => boolean, max = 10000): boolean => Array.isArray(v) && v.length <= max && v.every(check);
const record = (v: unknown, check: (item: any) => boolean): boolean => object(v) && Object.keys(v).length <= 100 && Object.entries(v).every(([k, value]) => !['__proto__', 'constructor', 'prototype'].includes(k) && check(value));
function requireValid(ok: boolean) { if (!ok) throw new Error('백업의 필수 값 또는 저장 형식이 올바르지 않아요.'); }

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
    && num(s.position) && num(s.duration) && num(s.listened) && num(s.master, 1.5) && record(s.layerSeconds, num)
    && record(s.mix, m => object(m) && num(m.volume, 1.5) && typeof m.muted === 'boolean' && typeof m.solo === 'boolean')
    && (s.loop === null || (object(s.loop) && num(s.loop.start) && num(s.loop.end) && s.loop.end > s.loop.start && s.loop.end <= s.duration))
    && (s.missionWeek === undefined || text(s.missionWeek))));
  requireValid(new Set(x.sessions.map((s: any) => s.id)).size === x.sessions.length && list(x.joinedWeeks, text));
  requireValid(x.extras === undefined || object(x.extras));
  const e = { ...defaultExtras(), ...x.extras, watch: { ...defaultExtras().watch, ...x.extras?.watch } };
  requireValid(['bass','kick','both'].includes(e.watch.source) && num(e.watch.threshold, 1) && Number.isFinite(e.watch.offset) && Math.abs(e.watch.offset) <= 300);
  requireValid([1,3,5].includes(e.missionGoal) && list(e.badges, text));
  requireValid(list(e.posts, p => object(p) && text(p.id) && text(p.author) && text(p.text) && typeof p.sample === 'boolean' && num(p.likes) && typeof p.liked === 'boolean' && list(p.comments, text) && (p.hidden === undefined || typeof p.hidden === 'boolean')));
  requireValid(list(e.motions, m => object(m) && text(m.id) && ids.has(m.projectId) && text(m.name) && num(m.createdAt) && object(m.result) && (m.video === undefined || text(m.video)), 1000));
  e.motions = e.motions.map((m: any) => {
    const trace = parseTrace(JSON.stringify(m.trace));
    if (m.trace.source === 'sample') trace.source = 'sample';
    return { ...m, sessionId: x.sessions.some((s: any) => s.id === m.sessionId && s.projectId === m.projectId) ? m.sessionId : undefined, trace, result: analyzeTrace(trace, m.result.bpm, m.result.offset) };
  });
  return { ...fallback, version: 1, server: x.server, projects: x.projects, sessions: x.sessions, joinedWeeks: x.joinedWeeks, extras: e };
}
