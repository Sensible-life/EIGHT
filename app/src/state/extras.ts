import type { HapticSource } from '../haptics/pattern';
import type { MotionResult, Trace } from '../motion/analyze';
export type MotionRecord = { id: string; projectId: string; sessionId?: string; name: string; createdAt: number; trace: Trace; result: MotionResult; video?: string };
export type Post = { id: string; author: string; text: string; sample: boolean; likes: number; liked: boolean; comments: string[]; hidden?: boolean };
export type Extras = { watch: { source: HapticSource; threshold: number; offset: number }; motions: MotionRecord[]; posts: Post[]; badges: string[]; missionGoal: number };
export const defaultExtras = (): Extras => ({ watch: { source: 'bass', threshold: .25, offset: 0 }, motions: [], posts: [], badges: [], missionGoal: 3 });
export const samplePosts = (): Post[] => [
  { id: 'sample-1', author: '리듬을 찾는 민 · 샘플', text: '베이스만 남기고 연습하니 음악이 다르게 들려요. 오늘은 팔 움직임에 집중!', sample: true, likes: 12, liked: false, comments: ['샘플 댓글 · 다음엔 킥에도 맞춰볼게요.'] },
  { id: 'sample-2', author: '춤추는 지우 · 샘플', text: '왼쪽과 오른쪽 공간을 번갈아 쓰는 연습을 했어요.', sample: true, likes: 8, liked: false, comments: [] },
];
