import type { Extras } from './extras';
import { validateLibrary } from './validation';
import type { Job } from '../api';
import type { Mix } from '../audio/mix';
import type { LoopRange } from '../audio/StemPlayer';
import type { SessionTracking } from '../tracking/types';

export type PlaybackSnapshot = {
  position: number; duration: number; mix: Mix; master: number;
  loop: LoopRange; listened: number; layerSeconds: Record<string, number>;
  tracking?: SessionTracking; // camera tab totals (src/tracking); absent until something was tracked
};
export type Project = { id: string; job: Job; server: string; saved: boolean; updatedAt: number; cached?: boolean; remoteFiles?: Record<string, string> };
export type Session = PlaybackSnapshot & { id: string; projectId: string; startedAt: number; endedAt?: number; missionWeek?: string };
export type Library = { version: 1; server: string; projects: Project[]; sessions: Session[]; joinedWeeks: string[]; extras?: Extras };
export function weekKey(now = new Date()) {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  day.setDate(day.getDate() - (day.getDay() + 6) % 7);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}
export const missionProgress = (sessions: Session[], week = weekKey(), goal = 3) => Math.min(goal, sessions.filter(s => s.missionWeek === week && !!s.endedAt && s.listened >= 30).length);
export function layerShares(sessions: Session[]) {
  const totals: Record<string, number> = {};
  for (const s of sessions) for (const [stem, seconds] of Object.entries(s.layerSeconds)) totals[stem] = (totals[stem] ?? 0) + seconds;
  const total = Object.values(totals).reduce((sum, v) => sum + v, 0);
  return Object.entries(totals).sort((a, b) => b[1] - a[1]).map(([stem, seconds]) => ({ stem, seconds, share: total ? seconds / total : 0 }));
}
export const projectKey = (job: Job, server: string) => `${job.config.model === 'imported' || job.id === 'demo-groove' ? 'local' : server.trim().replace(/\/$/, '')}::${job.id}`;
export function decodeLibrary(raw: string, fallback: Library): Library {
  return validateLibrary(raw, fallback);
}
