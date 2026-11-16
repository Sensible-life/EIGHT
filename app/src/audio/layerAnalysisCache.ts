import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import type { Pulse } from '../haptics/pattern';

export type LayerAnalysis = { waveform: number[]; envelope: number[]; pulses?: Pulse[] };
const VERSION = 1;
function hash(value: string): string {
  let hashValue = 2166136261;
  for (let i = 0; i < value.length; i++) hashValue = Math.imul(hashValue ^ value.charCodeAt(i), 16777619);
  return (hashValue >>> 0).toString(16);
}
function target(uri: string, stem: string) {
  if (Platform.OS === 'web' || !uri.startsWith('file://')) return null;
  const source = new File(uri), info = source.info();
  if (!info.exists || typeof info.size !== 'number' || typeof info.modificationTime !== 'number') return null;
  const identity = JSON.stringify([VERSION, uri, stem, info.size, info.modificationTime]);
  const dir = new Directory(Paths.document, 'layer-analysis');
  return { identity, dir, file: new File(dir, `${hash(identity)}.json`) };
}
export function layerAnalysisIdentity(uri: string, stem: string): string {
  try { return target(uri, stem)?.identity ?? `${VERSION}:${stem}:${uri}`; }
  catch { return `${VERSION}:${stem}:${uri}`; }
}
function valid(value: unknown): value is LayerAnalysis {
  if (!value || typeof value !== 'object') return false;
  const v = value as LayerAnalysis;
  const numbers = (arr: unknown, max: number) => Array.isArray(arr) && arr.length <= max && arr.every(x => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1);
  return numbers(v.waveform, 64) && v.waveform.length === 64 && numbers(v.envelope, 36000)
    && (v.pulses === undefined || (Array.isArray(v.pulses) && v.pulses.length <= 10000 && v.pulses.every(p => p && Number.isFinite(p.t) && p.t >= 0 && Number.isFinite(p.strength) && p.strength >= 0 && p.strength <= 1)));
}
export function readLayerAnalysis(uri: string, stem: string): LayerAnalysis | null {
  try {
    const entry = target(uri, stem);
    if (!entry?.file.exists) return null;
    const data = JSON.parse(entry.file.textSync());
    return data.identity === entry.identity && valid(data.analysis) ? data.analysis : null;
  } catch { return null; }
}
export function writeLayerAnalysis(uri: string, stem: string, analysis: LayerAnalysis): void {
  try {
    if (!valid(analysis)) return;
    const entry = target(uri, stem); if (!entry) return;
    entry.dir.create({ intermediates: true, idempotent: true });
    if (!entry.file.exists) entry.file.create();
    entry.file.write(JSON.stringify({ identity: entry.identity, analysis }));
  } catch { /* Cache failure must not block playback. */ }
}
