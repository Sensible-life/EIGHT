import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import type { Job } from '../api';
import { defaultExtras, Extras } from './extras';
import { deleteMedia, saveMedia } from '../storage/media';
import { decodeLibrary, Library, Project, PlaybackSnapshot, projectKey, Session, weekKey } from './model';

const KEY = 'choreo-layer-library-v1';
const empty: Library = { version: 1, server: Constants.expoConfig?.extra?.defaultServerUrl ?? 'http://192.168.0.10:8000', projects: [], sessions: [], joinedWeeks: [] };
function read() { return Platform.OS === 'web' ? localStorage.getItem(KEY) : (() => { const f = new File(Paths.document, `${KEY}.json`); return f.exists ? f.textSync() : null; })(); }
function write(data: Library) {
  const text = JSON.stringify(data);
  if (Platform.OS === 'web') localStorage.setItem(KEY, text);
  else { const f = new File(Paths.document, `${KEY}.json`); if (!f.exists) f.create(); f.write(text); }
}
type Context = {
  data: Library; ready: boolean; storageError: string; pending: string | null;
  setServer: (s: string) => void; select: (job: Job, server: string) => Promise<string>;
  choose: (id: string) => void; toggleSaved: (id: string) => void;
  start: (id: string, resume?: string) => string; checkpoint: (id: string, value: PlaybackSnapshot, end?: boolean) => void;
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
  useEffect(() => { try { const raw = read(); if (raw) { current.current = decodeLibrary(raw, empty); setData(current.current); } } catch { setStorageError('저장된 기록을 읽지 못했어요. 이 실행의 기록은 메모리에 유지됩니다.'); } finally { setReady(true); } }, []);
  const change = useCallback((fn: (d: Library) => Library) => {
    const next = fn(current.current); current.current = next; setData(next);
    try { write(next); setStorageError(''); } catch { setStorageError('기기 저장 공간을 확인해 주세요. 기록은 현재 실행 동안만 유지됩니다.'); }
  }, []);
  const select = useCallback(async (job: Job, server: string) => {
    const id = projectKey(job, server); let stableJob = job;
    const existing = current.current.projects.find(p => p.id === id);
    const created: string[] = [];
    if (job.config.model === 'imported' && !existing) {
      const files: Record<string, string> = {};
      try { for (const [stem, uri] of Object.entries(job.files ?? {})) { const ext = /\.[a-zA-Z0-9]+$/.exec(uri)?.[0] ?? '.wav'; files[stem] = await saveMedia(uri, ext); created.push(files[stem]); } }
      catch (error) { await Promise.all(created.map(uri => deleteMedia(uri).catch(() => {}))); throw error; }
      stableJob = { ...job, files };
    }
    change(d => ({ ...d, projects: [{ ...existing, id, job: existing?.cached ? existing.job : stableJob, server, saved: existing?.saved ?? false, updatedAt: Date.now() }, ...d.projects.filter(p => p.id !== id)] }));
    choose(id); return id;
  }, [change]);
  const patchProject = useCallback((id: string, patch: Partial<Project>) => change(d => ({ ...d, projects: d.projects.map(p => p.id === id ? { ...p, ...patch, id, updatedAt: Date.now() } : p) })), [change]);
  const updateExtras = useCallback((fn: (e: Extras) => Extras) => change(d => ({ ...d, extras: fn(d.extras ?? defaultExtras()) })), [change]);
  const removeProject = useCallback(async (id: string) => {
    const p = current.current.projects.find(p => p.id === id); if (!p) return;
    const videos = current.current.extras?.motions.filter(m => m.projectId === id).map(m => m.video).filter((v): v is string => !!v) ?? [];
    // Commit metadata removal first; no other project shares these managed files.
    change(d => ({ ...d, projects: d.projects.filter(p => p.id !== id), sessions: d.sessions.filter(s => s.projectId !== id), extras: { ...(d.extras ?? defaultExtras()), motions: (d.extras?.motions ?? []).filter(m => m.projectId !== id) } }));
    await Promise.all([...Object.values(p.job.files ?? {}), ...videos].map(deleteMedia));
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
    change(d => ({ ...d, projects: [...d.projects, ...incoming.projects.filter(p => !d.projects.some(x => x.id === p.id))], sessions: [...d.sessions, ...incoming.sessions.filter(s => !d.sessions.some(x => x.id === s.id))], joinedWeeks: [...new Set([...d.joinedWeeks, ...incoming.joinedWeeks])], extras: { ...(incoming.extras ?? defaultExtras()), badges: [...new Set([...(d.extras?.badges ?? []), ...(incoming.extras?.badges ?? [])])], posts: [...(d.extras?.posts ?? []), ...(incoming.extras?.posts ?? []).filter(p => !(d.extras?.posts ?? []).some(x => x.id === p.id))], motions: [...(d.extras?.motions ?? []), ...(incoming.extras?.motions ?? []).filter(m => !(d.extras?.motions ?? []).some(x => x.id === m.id))] } }));
  }, [change]);
  const start = useCallback((projectId: string, resume?: string) => {
    const prior = current.current.sessions.find(s => s.id === resume && s.projectId === projectId && !s.endedAt);
    if (prior) return prior.id;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const s: Session = { id, projectId, startedAt: Date.now(), position: 0, duration: 0, mix: {}, master: .8, loop: null, listened: 0, layerSeconds: {}, missionWeek: current.current.joinedWeeks.includes(weekKey()) ? weekKey() : undefined };
    change(d => ({ ...d, sessions: [s, ...d.sessions] })); return id;
  }, [change]);
  const checkpoint = useCallback((id: string, value: PlaybackSnapshot, end = false) => change(d => ({ ...d, sessions: d.sessions.map(s => s.id === id ? { ...s, ...value, endedAt: end ? Date.now() : s.endedAt } : s) })), [change]);
  return <LibraryContext.Provider value={{ data, ready, storageError, pending, select, choose, start, checkpoint, patchProject, updateExtras, removeProject, cacheProject, clearCache, restore,
    removeSession: useCallback((id: string) => change(d => ({ ...d, sessions: d.sessions.filter(s => s.id !== id), extras: { ...(d.extras ?? defaultExtras()), motions: (d.extras?.motions ?? []).map(m => m.sessionId === id ? { ...m, sessionId: undefined } : m) } })), [change]),
    setServer: useCallback((server: string) => change(d => ({ ...d, server })), [change]),
    toggleSaved: useCallback((id: string) => change(d => ({ ...d, projects: d.projects.map(p => p.id === id ? { ...p, saved: !p.saved } : p) })), [change]),
    joinMission: useCallback(() => change(d => ({ ...d, joinedWeeks: [...new Set([...d.joinedWeeks, weekKey()])] })), [change]),
  }}>{children}</LibraryContext.Provider>;
}
export function useLibrary() { const value = useContext(LibraryContext); if (!value) throw new Error('LibraryProvider required'); return value; }
