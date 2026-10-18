// Shared tracking types. Message shapes follow docs/TRACKING.md (= id403 docs/message-schema.md):
// their keys stay snake_case because they are the contract with the hardware / projector.

export const NUM_LANDMARKS = 33; // MediaPipe Pose topology

export type Vec3 = [number, number, number];
export type Landmarks = Vec3[];

/** One person's pose in one frame. */
export type PoseFrame = {
  tMs: number;
  image: Landmarks; // x, y in [0, 1] image coords (y down), z relative depth
  world: Landmarks; // meters, origin at hip center
  visibility: number[]; // 0..1 per landmark
};

export type Segment = 'head' | 'torso' | 'arm_l' | 'arm_r' | 'leg_l' | 'leg_r';
export type Level = 'low' | 'mid' | 'high';
export type WindowName = '8count' | 'recent' | 'session';
export type TrackerState = 'waiting' | 'calibrating' | 'tracking';
export type CueKind = 'segment_unexplored' | 'level_unexplored' | 'explored';
export type CueTarget = Segment | 'low' | 'high';

/** One tracking-state frame. scores is null when activity can't be measured this frame. */
export type FrameResult = {
  tMs: number;
  detected: boolean;
  scores: Record<Segment, number> | null;
  observed: Record<Segment, boolean> | null;
  level: Level | null;
};

/** Usage shares for one window. The message without a `type` field. */
export type UsageMessage = {
  t: number;
  window: WindowName;
  segments: Record<Segment, number>;
  level: Record<Level, number>;
  current_level: Level | null;
  underused: Segment[];
  tracking_ok: boolean;
};
export type FeedbackCue = { t: number; kind: CueKind; target: CueTarget; text: string };
export type FeedbackMessage = { type: 'feedback' } & FeedbackCue;
export type StatusMessage = { type: 'status'; t: number; state: TrackerState; progress: number; session_s: number };
/** Landmarks for drawing: 33 x [x, y, visibility], image coords, not mirrored. Never video. */
export type PoseMessage = { type: 'pose'; t: number; aspect: number; lm: Vec3[] };
export type Percentiles = { p50: number | null; p95: number | null };
export type PerfMessage = {
  type: 'perf';
  t: number;
  source_fps: number;
  pose_fps: number;
  detect_rate: number;
  lat_ms: { capture_pose: Percentiles; pipeline: Percentiles };
  capture_from: string;
  model: string;
  delegate: string;
  errors: number;
};
export type OutMessage = UsageMessage | FeedbackMessage | StatusMessage | PoseMessage | PerfMessage;

/** Running sums behind the usage windows. Saved with the session; never landmarks (principle 3). */
export type UsageTotals = {
  frames: number;
  score: Record<Segment, number>; // activity sum over observed frames
  observed: Record<Segment, number>; // frames in which the segment was visible
  levels: Record<Level, number>; // frames per level
};
export type SessionTracking = { version: 1; trackedMs: number; totals: UsageTotals };

/** One `onPose` event from the pose-camera module. Landmarks and timing only, no video. */
export type PoseEvent = {
  tMs: number; // SystemClock.elapsedRealtime() when the frame arrived (camera clock)
  seq: number; // camera frame counter (source fps)
  ageMs: number; // ms since the frame arrived, when the event was sent
  emitWallMs: number; // System.currentTimeMillis() when the event was sent
  latencyMs: number; // frame -> pose result (perf capture_pose)
  captureFrom: string; // 'sensor' | 'analyzer': where latencyMs starts
  aspect: number; // frame width / height (0.75 for an upright 4:3 frame)
  image: number[]; // 33 x [x, y, visibility], image coords, not mirrored; empty = nobody in view
  world: number[]; // 33 x [x, y, z] meters, hip-centered; empty = nobody in view
};
