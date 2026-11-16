import { createVideoPlayer } from 'expo-video';
import { Platform } from 'react-native';

/** Read actual source duration before adding an imported video to the timeline. */
export async function videoDuration(uri: string): Promise<number> {
  if (Platform.OS === 'web') {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      let done = false;
      const timer = setTimeout(() => finish(new Error('Could not read the video duration.')), 15000);
      const finish = (error?: Error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const duration = video.duration;
        video.onloadedmetadata = null; video.onerror = null;
        video.removeAttribute('src'); video.load();
        if (error || !Number.isFinite(duration) || duration <= 0) reject(error ?? new Error('Could not read the video duration.'));
        else resolve(duration);
      };
      video.preload = 'metadata';
      video.onloadedmetadata = () => finish();
      video.onerror = () => finish(new Error('Could not read the video.'));
      video.src = uri;
    });
  }
  const player = createVideoPlayer(null);
  try {
    return await new Promise<number>((resolve, reject) => {
      let done = false;
      const finish = (value?: number, error?: Error) => {
        if (done) return;
        done = true; clearTimeout(timer); loaded.remove(); failed.remove();
        if (value && Number.isFinite(value) && value > 0) resolve(value);
        else reject(error ?? new Error('Could not read the video duration.'));
      };
      const loaded = player.addListener('sourceLoad', event => finish(event.duration));
      const failed = player.addListener('statusChange', event => { if (event.status === 'error') finish(undefined, new Error(event.error?.message ?? 'Could not read the video.')); });
      const timer = setTimeout(() => finish(), 15000);
      void player.replaceAsync(uri).catch(error => finish(undefined, error instanceof Error ? error : new Error(String(error))));
    });
  } finally { player.release(); }
}
