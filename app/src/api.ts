import { File as LocalFile } from 'expo-file-system';
import { fetch as uploadFetch } from 'expo/fetch';

// 분석 서버 API + 분석 결과 타입 (server/app/analysis.py 출력과 1:1)

export type JobStatus = 'queued' | 'loading' | 'separating' | 'analyzing' | 'encoding' | 'done' | 'error';
export type SeparationProvider = 'demucs' | 'lalal';
export type LalalMode = 'vocals' | 'four_stem' | 'multistem';
export const LALAL_STEMS = ['vocals', 'drum', 'bass', 'piano', 'electric_guitar', 'acoustic_guitar', 'synthesizer', 'strings', 'wind'] as const;
export type LalalStem = typeof LALAL_STEMS[number];
export interface Health {
  ok: boolean;
  device: string;
  providers?: Partial<Record<SeparationProvider, { ready: boolean }>>;
}

export interface Job {
  id: string;
  name: string;
  status: JobStatus;
  stage: string;
  progress: number;
  error?: string;
  tempo?: number;
  stems?: string[];
  files?: Record<string, string>; // { mix, drums, bass, other, vocals }
  analysisUrl?: string;
  config: { model: string; shifts: number; overlap: number; provider?: SeparationProvider; lalal_mode?: LalalMode; lalal_stems?: LalalStem[] | null; split_vocals?: boolean };
  createdAt: number;
}

export interface Beat { t: number; count: number; eight: number; isDownbeat: boolean }
export interface Eight { index: number; start: number; end: number }
export interface Section {
  label: string; start: number; end: number; eights: number;
  energy: number; loudness: number; activeStems: string[];
}
export interface Phrase { start: number; end: number; section: string; eights: number }
export interface Accent { t: number; strength: number; count: number; offbeat: boolean }
export interface StemEvent { t: number; stem: string; type: 'enter' | 'exit'; eight: number }

export interface Analysis {
  version: number;
  duration: number;
  tempo: number;
  beatsPerBar: number;
  beatMethod: 'beat_this' | 'grid';
  stems: string[];
  beats: Beat[];
  eights: Eight[];
  sections: Section[];
  phrases: Phrase[];
  accents: Accent[];
  stemEvents: StemEvent[];
  envelope: { rate: number; mix: number[]; stems: Record<string, number[]> };
  separation: { model: string; shifts: number; device: string; seconds: number; provider?: SeparationProvider; lalal_mode?: LalalMode; lalal_stems?: LalalStem[] | null; split_vocals?: boolean };
}

export interface UploadOptions { model: string; shifts: number; overlap?: number; provider?: SeparationProvider; lalalMode?: LalalMode; lalalStems?: LalalStem[]; splitVocals?: boolean }

const clean = (base: string) => base.trim().replace(/\/+$/, '');

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  health: async (base: string) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try { return await json<Health>(await fetch(`${clean(base)}/health`, { signal: controller.signal })); }
    finally { clearTimeout(timer); }
  },
  jobs: (base: string) => fetch(`${clean(base)}/jobs`).then(r => json<Job[]>(r)),
  job: (base: string, id: string) => fetch(`${clean(base)}/jobs/${id}`).then(r => json<Job>(r)),
  analysis: (base: string, id: string) => fetch(`${clean(base)}/jobs/${id}/analysis`).then(r => json<Analysis>(r)),
  remove: (base: string, id: string) => fetch(`${clean(base)}/jobs/${id}`, { method: 'DELETE' }).then(r => json<{ ok: boolean }>(r)),
  upload: async (base: string, file: { uri: string; name: string; mimeType?: string; file?: File }, opt: UploadOptions, signal?: AbortSignal) => {
    const form = new FormData();
    // Expo fetch reads File.bytes() directly. RN Blob cannot accept binary buffers.
    if (file.file) form.append('file', file.file, file.name);
    else form.append('file', new LocalFile(file.uri));
    // Native cache filenames are generated; retain the picked name separately.
    form.append('original_name', file.name);
    form.append('model', opt.model);
    form.append('shifts', String(opt.shifts));
    form.append('overlap', String(opt.overlap ?? 0.25));
    form.append('provider', opt.provider ?? 'demucs');
    form.append('lalal_mode', opt.lalalMode ?? 'vocals');
    if (opt.lalalStems) form.append('lalal_stems', JSON.stringify(opt.lalalStems));
    form.append('split_vocals', String(opt.splitVocals ?? false));
    return uploadFetch(`${clean(base)}/jobs`, { method: 'POST', body: form, signal }).then(r => json<Job>(r));
  },
};

// ---------- 분석 결과 조회 헬퍼

/** 정렬된 배열에서 t 이하인 마지막 원소 index (없으면 -1) */
export function lastIndexAtOrBefore<T>(arr: T[], t: number, key: (x: T) => number): number {
  let lo = 0, hi = arr.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (key(arr[mid]) <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}
