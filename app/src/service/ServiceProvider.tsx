import { displayMessage } from '../ui/displayMessage';
import { File } from 'expo-file-system';
import { fetch as uploadFetch } from 'expo/fetch';
import { Platform } from 'react-native';
import { portableLibrary } from './snapshot';
import { deleteMedia, downloadPrivateMedia, mediaExists, resolveMedia } from '../storage/media';
import { createContext, useCallback, useContext, useState, type PropsWithChildren } from 'react';
import { useLibrary } from '../state/LibraryProvider';
import type { Library } from '../state/model';

type Account = { token: string; name: string; userId: string; server: string };
type Service = { account: Account | null; revision: number | null; authenticate: (mode: 'register' | 'login', name: string, password: string) => Promise<void>; logout: () => Promise<void>; request: <T>(path: string, method?: string, data?: unknown) => Promise<T>; download: () => Promise<void>; upload: () => Promise<void> };
const Context = createContext<Service | null>(null);
async function json<T>(response: Response): Promise<T> {
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(typeof body.detail === 'string' ? displayMessage(body.detail) : `Server error ${response.status}`); }
  return response.json() as Promise<T>;
}
export function ServiceProvider({ children }: PropsWithChildren) {
  const { data, restore } = useLibrary();
  const [session, setSession] = useState<Account | null>(null), [revision, setRevision] = useState<number | null>(null);
  const base = data.server.trim().replace(/\/$/, ''), account = session?.server === base ? session : null;
  const authenticate = useCallback(async (mode: 'register' | 'login', name: string, password: string) => {
    const result = await json<{ token: string; name: string; userId: string }>(await fetch(`${base}/service/${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password }) }));
    setRevision(null); setSession({ ...result, server: base });
  }, [base]);
  const request = useCallback(async <T,>(path: string, method = 'GET', value?: unknown): Promise<T> => {
    if (!account) throw new Error("Please sign in first.");
    return json<T>(await fetch(`${account.server}/service${path}`, { method, headers: { Authorization: `Bearer ${account.token}`, ...(value === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) }));
  }, [account]);
  const logout = useCallback(async () => { try { if (account) await request('/logout', 'POST'); } finally { setSession(null); setRevision(null); } }, [account, request]);
  const download = useCallback(async () => {
    if (!account) throw new Error("Please sign in first.");
    const result = await request<{ revision: number; data: Library | null }>('/snapshot');
    const created: string[] = [];
    try {
      if (result.data?.extras) {
        const downloadVideo = async (uri: string | undefined, local: string | undefined) => {
          if (!uri?.startsWith('cloud://')) return uri;
          if (local && await mediaExists(local)) return local;
          const id = uri.slice('cloud://'.length);
          if (!/^[a-f0-9]{32}$/.test(id)) throw new Error("Invalid video identifier.");
          const saved = await downloadPrivateMedia(`${account.server}/service/media/${id}`, account.token); created.push(saved); return saved;
        };
        for (const item of result.data.extras.motifs ?? []) item.video = await downloadVideo(item.video, data.extras?.motifs.find(m => m.id === item.id)?.video);
        for (const item of result.data.extras.motions ?? []) item.video = await downloadVideo(item.video, data.extras?.motions.find(m => m.id === item.id)?.video);
        for (const item of result.data.extras.finished ?? []) item.video = (await downloadVideo(item.video, data.extras?.finished.find(m => m.id === item.id)?.video)) ?? '';
      }
      if (result.data) restore(JSON.stringify(result.data));
      setRevision(result.revision);
    } catch (e) { await Promise.all(created.map(uri => deleteMedia(uri).catch(() => {}))); throw e; }
  }, [account, request, restore, data.extras]);
  const upload = useCallback(async () => {
    if (revision === null) throw new Error("Download records from the other device first.");
    if (!account) throw new Error("Please sign in first.");
    const latest = await request<{ revision: number }>('/snapshot');
    if (latest.revision !== revision) throw new Error("Records changed on another device. Download them first.");
    const portable = portableLibrary(data), sent = new Map<string, string>();
    const uploadVideo = async (uri: string) => {
      if (sent.has(uri)) return sent.get(uri)!;
      const form = new FormData();
      if (Platform.OS === 'web') { const media = await resolveMedia(uri); try { const response = await fetch(media.uri); if (!response.ok) throw new Error("Could not read the video on this device."); form.append('file', await response.blob(), 'clip.mp4'); } finally { media.release(); } }
      else form.append('file', new File(uri));
      const item = await json<{ id: string }>(await uploadFetch(`${account.server}/service/media`, { method: 'POST', headers: { Authorization: `Bearer ${account.token}` }, body: form }));
      const result = `cloud://${item.id}`; sent.set(uri, result); return result;
    };
    if (portable.extras && data.extras) {
      for (let i = 0; i < portable.extras.motifs.length; i++) if (data.extras.motifs[i].video) portable.extras.motifs[i].video = await uploadVideo(data.extras.motifs[i].video!);
      for (let i = 0; i < portable.extras.motions.length; i++) if (data.extras.motions[i].video) portable.extras.motions[i].video = await uploadVideo(data.extras.motions[i].video!);
      for (let i = 0; i < portable.extras.finished.length; i++) portable.extras.finished[i].video = await uploadVideo(data.extras.finished[i].video);
    }
    const result = await request<{ revision: number }>('/snapshot', 'PUT', { revision, data: portable });
    setRevision(result.revision);
  }, [account, request, revision, data]);
  return <Context.Provider value={{ account, revision, authenticate, logout, request, download, upload }}>{children}</Context.Provider>;
}
export function useService() { const value = useContext(Context); if (!value) throw new Error('ServiceProvider required'); return value; }
