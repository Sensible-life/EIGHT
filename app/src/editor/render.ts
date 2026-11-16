import { File, Paths } from 'expo-file-system';
import { fetch as uploadFetch } from 'expo/fetch';
import { Platform } from 'react-native';
import type { Motif } from '../state/extras';
import { deleteMedia, resolveMedia, saveMedia } from '../storage/media';
import type { TimelineClip } from './timeline';

/** Upload source media, then persist the completed MP4 in app-owned storage. */
export async function renderChoreography(server: string, files: Record<string, string>, clips: TimelineClip[], motifs: Motif[]): Promise<string> {
  const form = new FormData(), temporary: string[] = [];
  const addFile = async (field: string, uri: string, name: string) => {
    if (Platform.OS === 'web') {
      const media = await resolveMedia(uri);
      try { const response = await fetch(media.uri); if (!response.ok) throw new Error('Could not read a source file.'); form.append(field, await response.blob(), name); }
      finally { media.release(); }
    } else {
      if (/^https?:/.test(uri)) { uri = await saveMedia(uri); temporary.push(uri); }
      form.append(field, new File(uri));
    }
  };
  try {
    // Use the same layers as the preview; fall back to the original mix.
    const layers = Object.entries(files).filter(([name]) => name !== 'mix').map(([, uri]) => uri);
    const audios = layers.length ? layers : files.mix ? [files.mix] : [];
    if (!audios.length) throw new Error('Reconnect the project music before exporting.');
    for (let i = 0; i < audios.length; i++) await addFile('audios', audios[i], `audio-${i}`);
    const sorted = [...clips].sort((a, b) => a.start - b.start);
    for (let i = 0; i < sorted.length; i++) {
      const video = motifs.find(m => m.id === sorted[i].motifId)?.video;
      if (!video) throw new Error('A source video is missing.');
      await addFile('videos', video, `video-${i}`);
    }
    form.append('timeline', JSON.stringify(sorted.map(clip => { const motif = motifs.find(m => m.id === clip.motifId); const rate = motif?.videoRate ?? 1; return { ...clip, sourceStart: clip.sourceStart / rate + (motif?.videoOffset ?? 0), sourceRate: rate }; })));
    const response = await uploadFetch(`${server.trim().replace(/\/+$/, '')}/choreography/render`, { method: 'POST', body: form });
    if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(typeof body.detail === 'string' ? body.detail : `Export failed (${response.status}).`); }
    if (Platform.OS === 'web') {
      const blob = await response.blob(), url = URL.createObjectURL(blob);
      try { return await saveMedia(url, '.mp4'); } finally { URL.revokeObjectURL(url); }
    }
    const output = new File(Paths.cache, `render-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);
    try { output.write(new Uint8Array(await response.arrayBuffer())); return await saveMedia(output.uri, '.mp4'); }
    finally { if (output.exists) output.delete(); }
  } finally { await Promise.all(temporary.map(uri => deleteMedia(uri).catch(() => {}))); }
}
