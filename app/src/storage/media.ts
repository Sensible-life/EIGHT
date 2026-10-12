import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
const PREFIX = 'media://';
let opened: Promise<IDBDatabase> | undefined;
function db() { return opened ??= new Promise((resolve, reject) => { const req = indexedDB.open('choreolayer-media', 1); req.onupgradeneeded = () => req.result.createObjectStore('files'); req.onsuccess = () => resolve(req.result); req.onerror = () => { opened = undefined; reject(req.error); }; }); }
async function transaction<T>(mode: IDBTransactionMode, action: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> { const database = await db(); return new Promise((resolve, reject) => { const tx = database.transaction('files', mode); const req = action(tx.objectStore('files')); tx.oncomplete = () => resolve(req.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error ?? new Error('파일 저장이 중단됐어요.')); }); }
function root() { const dir = new Directory(Paths.document, 'media'); dir.create({ intermediates: true, idempotent: true }); return dir; }
export async function saveMedia(uri: string, suffix = '.bin'): Promise<string> {
  const key = `${Date.now()}-${Math.random().toString(36).slice(2)}${suffix.replace(/[^a-zA-Z0-9.]/g, '').slice(0, 10)}`;
  if (Platform.OS === 'web') { const media = await resolveMedia(uri); let blob: Blob; try { const r = await fetch(media.uri); if (!r.ok) throw new Error(`파일 다운로드 실패 (${r.status})`); blob = await r.blob(); } finally { media.release(); } if (!blob.size) throw new Error('빈 파일은 저장할 수 없어요.'); await transaction('readwrite', s => s.put(blob, key)); return PREFIX + key; }
  const target = new File(root(), key);
  try {
    if (/^https?:/.test(uri)) await File.downloadFileAsync(uri, target); else new File(uri).copy(target);
    if (!target.exists || !target.size) throw new Error('파일을 저장하지 못했어요.');
  } catch (error) { if (target.exists) target.delete(); throw error; }
  return target.uri;
}
export async function resolveMedia(uri: string): Promise<{ uri: string; release: () => void }> { if (!uri.startsWith(PREFIX)) return { uri, release: () => {} }; const blob = await transaction('readonly', s => s.get(uri.slice(PREFIX.length))); if (!(blob instanceof Blob)) throw new Error('기기에 파일이 없어요. 프로젝트에서 파일을 다시 연결해 주세요.'); const url = URL.createObjectURL(blob); return { uri: url, release: () => URL.revokeObjectURL(url) }; }
export async function deleteMedia(uri: string) { if (uri.startsWith(PREFIX)) await transaction('readwrite', s => s.delete(uri.slice(PREFIX.length))); else if (Platform.OS !== 'web' && uri.startsWith(root().uri.replace(/\/+$/, '') + '/')) { const f = new File(uri); if (f.exists) f.delete(); } }
export async function mediaUsage(): Promise<number> { if (Platform.OS === 'web') { const blobs = await transaction('readonly', s => s.getAll()); return blobs.reduce((sum: number, b: Blob) => sum + b.size, 0); } return root().list().reduce((sum, f) => sum + (f instanceof File ? f.size : 0), 0); }
export async function readTextFile(uri: string) { if (Platform.OS === 'web') { const r = await fetch(uri); return r.text(); } return new File(uri).text(); }
