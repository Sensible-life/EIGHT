/** A single silent video clip placed on the music timeline. Times are seconds. */
export type TimelineClip = { id: string; motifId: string; start: number; sourceStart: number; duration: number; focusLayers?: string[] };
export type TimelineDraft = { id: string; projectId: string; name: string; updatedAt: number; clips: TimelineClip[] };
export type FinishedTimeline = { id: string; projectId: string; name: string; createdAt: number; clips: TimelineClip[]; video: string };

export const clipEnd = (clip: TimelineClip) => clip.start + clip.duration;
export function clipAt(clips: TimelineClip[], time: number): TimelineClip | undefined {
  return clips.find(clip => time >= clip.start && time < clipEnd(clip));
}
/** Keep clips within the track and prevent overlapping another clip on the same video track. */
export function placeClip(clips: TimelineClip[], clip: TimelineClip, proposed: number, trackDuration: number): TimelineClip | null {
  if (!(trackDuration > 0) || !(clip.duration > 0) || clip.duration > trackDuration) return null;
  const limit = trackDuration - clip.duration;
  const position = Math.max(0, Math.min(limit, proposed));
  const others = clips.filter(c => c.id !== clip.id).sort((a, b) => a.start - b.start);
  const candidates = [position, 0, limit, ...others.flatMap(c => [clipEnd(c), c.start - clip.duration])]
    .filter(t => t >= 0 && t <= limit && others.every(c => t + clip.duration <= c.start + 1e-6 || t >= clipEnd(c) - 1e-6));
  if (!candidates.length) return null;
  const start = candidates.reduce((best, value) => Math.abs(value - position) < Math.abs(best - position) ? value : best);
  return { ...clip, start: Math.round(start * 100) / 100 };
}
/** Clamp a clip's duration to its source and the next clip or end of the music. */
export function resizeClip(clips: TimelineClip[], clip: TimelineClip, duration: number, sourceDuration: number, trackDuration: number): TimelineClip | null {
  const next = clips.filter(c => c.id !== clip.id && c.start >= clip.start).reduce((end, c) => Math.min(end, c.start), trackDuration);
  const max = Math.min(sourceDuration - clip.sourceStart, next - clip.start, trackDuration - clip.start);
  if (max < 0.1) return null;
  return { ...clip, duration: Math.round(Math.max(0.1, Math.min(max, duration)) * 100) / 100 };
}
