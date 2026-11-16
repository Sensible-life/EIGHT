import type { TimelineDraft } from '../editor/timeline';
import type { Session } from '../state/model';

export function selectSessions(sessions: Session[], projectId: string | null, since: number | null): Session[] {
  return sessions.filter(session => (!projectId || session.projectId === projectId) && (since === null || session.startedAt >= since)).sort((a, b) => b.startedAt - a.startedAt);
}

/** Count each tagged clip once for every user-selected layer; no listening inference. */
export function focusSummary(timelines: TimelineDraft[], projectId: string | null) {
  const clips = timelines.filter(timeline => !projectId || timeline.projectId === projectId).flatMap(timeline => timeline.clips);
  const tagged = clips.filter(clip => (clip.focusLayers?.length ?? 0) > 0);
  const counts = new Map<string, { clips: number; seconds: number }>();
  for (const clip of tagged) for (const layer of new Set(clip.focusLayers)) {
    const value = counts.get(layer) ?? { clips: 0, seconds: 0 };
    value.clips++; value.seconds += clip.duration; counts.set(layer, value);
  }
  return { totalClips: clips.length, taggedClips: tagged.length, layers: [...counts].map(([stem, value]) => ({ stem, ...value })).sort((a, b) => b.clips - a.clips || b.seconds - a.seconds || a.stem.localeCompare(b.stem)) };
}
