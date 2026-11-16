import type { HapticSource } from '../haptics/pattern';
import type { Segment, Level } from '../tracking/types';
import type { Mix } from '../audio/mix';
import type { MotionResult, Trace } from '../motion/analyze';
import type { FinishedTimeline, TimelineDraft } from '../editor/timeline';
export type MotionRecord = { id: string; projectId: string; sessionId?: string; name: string; createdAt: number; trace: Trace; result: MotionResult; video?: string };
export type Post = { id: string; author: string; text: string; sample: boolean; likes: number; liked: boolean; comments: string[]; hidden?: boolean };
export type Motif = { id: string; projectId: string; sessionId?: string; name: string; createdAt: number; start: number; end: number; eightIndex: number | null; body?: Record<Segment, number>; level?: Record<Level, number>; mix?: Mix; video?: string; videoOffset?: number; videoRate?: number };
export type Composition = { id: string; projectId: string; name: string; motifIds: string[]; createdAt: number };
export type Extras = { watch: { source: HapticSource; threshold: number; offset: number }; motions: MotionRecord[]; motifs: Motif[]; compositions: Composition[]; timelines: TimelineDraft[]; finished: FinishedTimeline[]; posts: Post[]; badges: string[]; missionGoal: number; exploreLiked: string[]; exploreSaved: string[] };
export const defaultExtras = (): Extras => ({ watch: { source: 'bass', threshold: .25, offset: 0 }, motions: [], motifs: [], compositions: [], timelines: [], finished: [], posts: [], badges: [], missionGoal: 3, exploreLiked: [], exploreSaved: [] });
export const samplePosts = (): Post[] => [
  { id: 'sample-1', author: "Min · Sample", text: "Practiced with just the bass layer today.", sample: true, likes: 12, liked: false, comments: ["Sample comment · I'll try the kick next time."] },
  { id: 'sample-2', author: "Jiwoo · Sample", text: "Practiced moving between the left and right sides.", sample: true, likes: 8, liked: false, comments: [] },
];
