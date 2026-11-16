import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import type { Job } from '../api';
import { defaultExtras, Extras } from './extras';
import { deleteMedia, saveMedia } from '../storage/media';
import { decodeLibrary, Library, Project, PlaybackSnapshot, projectKey, Session, weekKey } from './model';

const KEY = 'choreo-layer-library-v1';
// In a development build Metro normally runs on the same Mac as the API.
function developmentServer(): string | null {
  if (!__DEV__) return null;
  const hostUri = Constants.expoConfig?.hostUri;
  if (!hostUri) return null;
  try {
    const host = new URL(`http://${hostUri}`).hostname;
    return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ? `http://${host}:8000` : null;
  } catch { return null; }
}
function reconnectDevelopmentProjects(data: Library, server: string): Library {
  const previous = data.server.replace(/\/$/, '');
  if (previous === server) return { ...data, server };
  const moveUrl = (url: string) => url.startsWith(`${previous}/`) ? `${server}${url.slice(previous.length)}` : url;
  const moveFiles = (files?: Record<string, string>) => files && Object.fromEntries(Object.entries(files).map(([name, url]) => [name, moveUrl(url)]));
  return { ...data, server, projects: data.projects.map(project => project.server.replace(/\/$/, '') !== previous ? project : {
    ...project, server,
    remoteFiles: moveFiles(project.remoteFiles),
    job: { ...project.job, files: moveFiles(project.job.files), ...(project.job.analysisUrl ? { analysisUrl: moveUrl(project.job.analysisUrl) } : {}) },
  }) };
}

const empty: Library = { version: 1, server: developmentServer() ?? Constants.expoConfig?.extra?.defaultServerUrl ?? 'http://192.168.0.10:8000', projects: [], sessions: [], joinedWeeks: [] };
function read() { return Platform.OS === 'web' ? localStorage.getItem(KEY) : (() => { const f = new File(Paths.document, `${KEY}.json`); return f.exists ? f.textSync() : null; })(); }
function write(data: Library) {
  const text = JSON.stringify(data);
  if (Platform.OS === 'web') localStorage.setItem(KEY, text);
  else { const f = new File(Paths.document, `${KEY}.json`); if (!f.exists) f.create(); f.write(text); }
}
type Context = {
  data: Library; ready: boolean; storageError: string; pending: string | null;
  setServer: (s: string) => void; select: (job: Job, server: string) => Promise<string>;
  choose: (id: string) => void;
  start: (id: string, resume?: string, motifId?: string, compositionId?: string, mission?: { id: string; title: string }) => string; checkpoint: (id: string, value: PlaybackSnapshot, end?: boolean) => void;
  joinMission: () => void;
  updateExtras: (fn: (e: Extras) => Extras) => void;
  patchProject: (id: string, patch: Partial<Project>) => void;
  removeProject: (id: string) => Promise<void>;
  removeSession: (id: string) => void;
  restore: (text: string) => void;
  cacheProject: (id: string, progress: (done: number, total: number) => void) => Promise<void>;
  clearCache: (id: string) => Promise<void>;

};
const LibraryContext = createContext<Context | null>(null);
export function LibraryProvider({ children }: PropsWithChildren) {
  const [data, setData] = useState(empty), [ready, setReady] = useState(false), [storageError, setStorageError] = useState('');
  const [pending, choose] = useState<string | null>(null);
  const current = useRef(data);
  useEffect(() => { try { const raw = read(); if (raw) { current.current = decodeLibrary(raw, empty); const devServer = developmentServer(); const previousDefault = 'http://192.168.0.10:8000'; const server = devServer ?? (current.current.server === previousDefault ? empty.server : current.current.server); current.current = devServer || current.current.server === previousDefault ? reconnectDevelopmentProjects(current.current, server) : { ...current.current, server }; setData(current.current); } } catch { setStorageError("Could not read saved records. Changes will be kept in memory for this session."); } finally { setReady(true); } }, []);
  const change = useCallback((fn: (d: Library) => Library) => {
    const next = fn(current.current); current.current = next; setData(next);
    try { write(next); setStorageError(''); } catch { setStorageError("Check device storage. Records will only be kept for this session."); }
  }, []);
  const select = useCallback(async (job: Job, server: string) => {
    const key = projectKey(job, server); let stableJob = job;
    const existing = current.current.projects.find(p => p.id === key || (p.server === server && p.job.id === job.id));
    const id = existing?.id ?? key;
    const created: string[] = [];
    const imported = job.config.model === 'imported';
    const remote = !imported && job.config.model !== 'demo';
    const download = (!existing && imported) || (remote && !existing?.cached);
    if (download) {
      const files: Record<string, string> = {};
      try {
        const entries = Object.entries(job.files ?? {});
        if (!entries.length) throw new Error('No audio files are available for this project.');
        for (const [stem, uri] of entries) { const ext = /\.[a-zA-Z0-9]+(?=\?|$)/.exec(uri)?.[0] ?? (imported ? '.wav' : '.mp3'); files[stem] = await saveMedia(uri, ext); created.push(files[stem]); }
      } catch (error) { await Promise.all(created.map(uri => deleteMedia(uri).catch(() => {}))); throw error; }
      stableJob = { ...job, files };
    }
    change(d => ({ ...d, projects: [{ ...existing, id, job: existing && (existing.cached || imported) ? existing.job : stableJob, server, saved: existing?.saved ?? false, ...(remote && download ? { cached: true, remoteFiles: job.files } : {}), updatedAt: Date.now() }, ...d.projects.filter(p => p.id !== id)] }));
    choose(id); return id;
  }, [change]);
  const patchProject = useCallback((id: string, patch: Partial<Project>) => change(d => ({ ...d, projects: d.projects.map(p => p.id === id ? { ...p, ...patch, id, updatedAt: Date.now() } : p) })), [change]);
  const updateExtras = useCallback((fn: (e: Extras) => Extras) => change(d => ({ ...d, extras: fn(d.extras ?? defaultExtras()) })), [change]);
  const removeProject = useCallback(async (id: string) => {
    const p = current.current.projects.find(p => p.id === id); if (!p) return;
    const videos = current.current.extras?.motions.filter(m => m.projectId === id).map(m => m.video).filter((v): v is string => !!v) ?? [];
    const motifVideos = current.current.extras?.motifs.filter(m => m.projectId === id).map(m => m.video).filter((v): v is string => !!v) ?? [];
    const finishedVideos = current.current.extras?.finished.filter(m => m.projectId === id).map(m => m.video) ?? [];
    // Commit metadata removal first; no other project shares these managed files.
    change(d => ({ ...d, projects: d.projects.filter(p => p.id !== id), sessions: d.sessions.filter(s => s.projectId !== id), extras: { ...(d.extras ?? defaultExtras()), motions: (d.extras?.motions ?? []).filter(m => m.projectId !== id), motifs: (d.extras?.motifs ?? []).filter(m => m.projectId !== id), compositions: (d.extras?.compositions ?? []).filter(c => c.projectId !== id), timelines: (d.extras?.timelines ?? []).filter(c => c.projectId !== id), finished: (d.extras?.finished ?? []).filter(c => c.projectId !== id) } }));
    await Promise.all([...Object.values(p.job.files ?? {}), ...videos, ...motifVideos, ...finishedVideos].map(deleteMedia));
  }, [change]);
  const cacheProject = useCallback(async (id: string, progress: (done: number, total: number) => void) => {
    const p = current.current.projects.find(p => p.id === id); if (!p || p.cached) return;
    const entries = Object.entries(p.job.files ?? {}), files: Record<string, string> = {}, created: string[] = [];
    try { for (const [stem, uri] of entries) { files[stem] = await saveMedia(uri, /\.[a-zA-Z0-9]+(?=\?|$)/.exec(uri)?.[0] ?? '.mp3'); created.push(files[stem]); progress(created.length, entries.length); } }
    catch (e) { await Promise.all(created.map(uri => deleteMedia(uri).catch(() => {}))); throw e; }
    if (!current.current.projects.some(item => item.id === id)) { await Promise.all(created.map(deleteMedia)); return; }
    patchProject(id, { cached: true, remoteFiles: p.job.files, job: { ...p.job, files } });
  }, [patchProject]);
  const clearCache = useCallback(async (id: string) => {
    const p = current.current.projects.find(p => p.id === id); if (!p?.cached || !p.remoteFiles) return;
    patchProject(id, { cached: false, job: { ...p.job, files: p.remoteFiles }, remoteFiles: undefined });
    await Promise.all(Object.values(p.job.files ?? {}).map(deleteMedia));
  }, [patchProject]);
  const restore = useCallback((text: string) => {
    const incoming = decodeLibrary(text, empty);
    // Merge metadata only; existing local media locations win for matching projects.
    change(d => ({ ...d, projects: [...d.projects, ...incoming.projects.filter(p => !d.projects.some(x => x.id === p.id))], sessions: [...d.sessions.map(s => { const remote = incoming.sessions.find(x => x.id === s.id); return remote && (remote.listened > s.listened || (!!remote.endedAt && !s.endedAt)) ? remote : s; }), ...incoming.sessions.filter(s => !d.sessions.some(x => x.id === s.id))], joinedWeeks: [...new Set([...d.joinedWeeks, ...incoming.joinedWeeks])], extras: { ...(incoming.extras ?? defaultExtras()), badges: [...new Set([...(d.extras?.badges ?? []), ...(incoming.extras?.badges ?? [])])], posts: [...(d.extras?.posts ?? []), ...(incoming.extras?.posts ?? []).filter(p => !(d.extras?.posts ?? []).some(x => x.id === p.id))], motions: [...(d.extras?.motions ?? []).map(m => ({ ...m, video: incoming.extras?.motions.find(x => x.id === m.id)?.video ?? m.video })), ...(incoming.extras?.motions ?? []).filter(m => !(d.extras?.motions ?? []).some(x => x.id === m.id))], motifs: [...(d.extras?.motifs ?? []).map(m => ({ ...m, video: incoming.extras?.motifs.find(x => x.id === m.id)?.video ?? m.video })), ...(incoming.extras?.motifs ?? []).filter(m => !(d.extras?.motifs ?? []).some(x => x.id === m.id))], compositions: [...(d.extras?.compositions ?? []), ...(incoming.extras?.compositions ?? []).filter(c => !(d.extras?.compositions ?? []).some(x => x.id === c.id))], timelines: [...(d.extras?.timelines ?? []), ...(incoming.extras?.timelines ?? []).filter(c => !(d.extras?.timelines ?? []).some(x => x.projectId === c.projectId))], finished: [...(d.extras?.finished ?? []), ...(incoming.extras?.finished ?? []).filter(c => !(d.extras?.finished ?? []).some(x => x.id === c.id))] } }));
  }, [change]);
  const start = useCallback((projectId: string, resume?: string, motifId?: string, compositionId?: string, mission?: { id: string; title: string }) => {
    const prior = current.current.sessions.find(s => s.id === resume && s.projectId === projectId && !s.endedAt);
    if (prior) return prior.id;
    const motif = current.current.extras?.motifs.find(m => m.id === motifId && m.projectId === projectId);
    const composition = current.current.extras?.compositions.find(c => c.id === compositionId && c.projectId === projectId);
    const items = composition?.motifIds.map(mid => current.current.extras?.motifs.find(m => m.id === mid && m.projectId === projectId)).filter((m): m is NonNullable<typeof m> => !!m) ?? [];
    const ranges = items.map(m => ({ start: m.start, end: m.end }));
    const first = items[0] ?? motif;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const s: Session = { id, projectId, startedAt: Date.now(), position: first?.start ?? 0, duration: first ? Math.max(first.end, ...ranges.map(r => r.end)) : 0, mix: first?.mix ?? {}, master: .8, loop: first ? { start: first.start, end: first.end } : null, ...(ranges.length ? { composition: { ranges, index: 0 } } : {}), listened: 0, layerSeconds: {}, ...(mission ? { missionWeek: weekKey(), missionId: mission.id, missionTitle: mission.title } : {}) };
    change(d => ({ ...d, sessions: [s, ...d.sessions] })); return id;
  }, [change]);
  const checkpoint = useCallback((id: string, value: PlaybackSnapshot, end = false) => change(d => ({ ...d, sessions: d.sessions.map(s => s.id === id ? { ...s, ...value, endedAt: end ? Date.now() : s.endedAt } : s) })), [change]);
  return <LibraryContext.Provider value={{ data, ready, storageError, pending, select, choose, start, checkpoint, patchProject, updateExtras, removeProject, cacheProject, clearCache, restore,
    removeSession: useCallback((id: string) => change(d => ({ ...d, sessions: d.sessions.filter(s => s.id !== id), extras: { ...(d.extras ?? defaultExtras()), motions: (d.extras?.motions ?? []).map(m => m.sessionId === id ? { ...m, sessionId: undefined } : m) } })), [change]),
    setServer: useCallback((server: string) => change(d => ({ ...d, server })), [change]),
    joinMission: useCallback(() => change(d => ({ ...d, joinedWeeks: [...new Set([...d.joinedWeeks, weekKey()])] })), [change]),
  }}>{children}</LibraryContext.Provider>;
}
export function useLibrary() { const value = useContext(LibraryContext); if (!value) throw new Error('LibraryProvider required'); return value; }
