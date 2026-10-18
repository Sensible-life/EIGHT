// Glue between the pose-camera events, the music player and the camera tab. Holds one LiveSession for the
// whole practice session (it outlives tab switches) and exposes a throttled view for useSyncExternalStore.
import { DEFAULT_CONFIG, type TrackingConfig } from './config';
import { LiveSession } from './session';
import { NUM_LANDMARKS } from './types';
import { countInEight, planFor, type EightPlan } from './windows';
import type {
  FeedbackCue, Landmarks, OutMessage, PerfMessage, PoseEvent, PoseFrame, PoseMessage, SessionTracking,
  StatusMessage, TrackerState, UsageMessage, WindowName,
} from './types';

export type MusicSource = () => { position: number; playing: boolean };
export type PlanName = 'eights' | 'tempo' | 'fixed' | 'rolling';
export type TrackingView = {
  status: StatusMessage | null;
  usage: Partial<Record<WindowName, UsageMessage>>;
  cue: FeedbackCue | null; // cleared after app.cue_show_s
  perf: PerfMessage | null;
  pose: PoseMessage | null; // null = nobody in view
  playing: boolean;
  count: number | null; // 1..8 inside the current eight
  plan: PlanName;
  engine: { model: string; delegate: string };
  error: string | null;
};

/** Song position of a frame: the player position now, minus how old the frame is. */
export function frameMusicTime(position: number, ageMs: number, emitWallMs: number, wallNowMs: number): number {
  return position - (ageMs + Math.max(0, wallNowMs - emitWallMs)) / 1000;
}

/** The event's pose, or null when nobody is in view (the module sends empty arrays then). */
export function poseFromEvent(e: PoseEvent): PoseFrame | null {
  if (e.image.length !== 3 * NUM_LANDMARKS || e.world.length !== 3 * NUM_LANDMARKS) return null;
  const image: Landmarks = [], world: Landmarks = [], visibility: number[] = [];
  for (let i = 0; i < NUM_LANDMARKS; i++) {
    image.push([e.image[3 * i], e.image[3 * i + 1], 0]);
    visibility.push(e.image[3 * i + 2]);
    world.push([e.world[3 * i], e.world[3 * i + 1], e.world[3 * i + 2]]);
  }
  return { tMs: e.tMs, image, world, visibility };
}

const planName = (p: EightPlan): PlanName => (p.kind === 'grid' ? p.source : p.kind);

export class LiveTrackingStore {
  readonly session: LiveSession;
  private view: TrackingView;
  private pending: Partial<TrackingView> = {};
  private listeners = new Set<() => void>();
  private music: MusicSource | null = null;
  private plan: EightPlan;
  private lastFlush = -Infinity;
  private cueAtMs = 0;
  private lastTMs = 0;
  private mustCalibrate = false; // [다시 맞추기] pressed: the next [춤 시작] measures again
  private readonly wallNow: () => number;

  constructor(private readonly cfg: TrackingConfig = DEFAULT_CONFIG, o: { wallNowMs?: () => number; perfNowMs?: () => number } = {}) {
    this.wallNow = o.wallNowMs ?? (() => Date.now());
    this.plan = planFor(null, null, cfg.aggregate.windows['8count_s']);
    this.session = new LiveSession(cfg, m => this.onMessage(m), {
      model: 'lite', delegate: 'gpu', captureFrom: 'sensor', clockMs: this.wallNow, perfNowMs: o.perfNowMs, plan: this.plan,
    });
    this.view = { status: null, usage: {}, cue: null, perf: null, pose: null, playing: false, count: null, plan: planName(this.plan), engine: { model: 'lite', delegate: 'gpu' }, error: null };
  }

  get trackerState(): TrackerState {
    return this.session.pipeline.tracker.state;
  }

  get calibrated(): boolean {
    return !this.mustCalibrate && this.session.pipeline.tracker.calibration !== null;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getView = (): TrackingView => this.view;

  setMusicSource(source: MusicSource | null): void {
    this.music = source;
  }

  setPlan(plan: EightPlan): void {
    this.plan = plan;
    this.session.setPlan(plan);
    this.set({ plan: planName(plan) }, true);
  }

  importTracking(saved: SessionTracking | undefined): void {
    if (saved) this.session.importTracking(saved);
  }

  /** What to save with the practice session; null until something was tracked or restored. */
  exportTracking(): SessionTracking | null {
    const s = this.session.exportTracking();
    return s.trackedMs > 0 || s.totals.frames > 0 ? s : null;
  }

  /**
   * The [다시 맞추기] button: reset the tracker, keep the session totals, and make the next [춤 시작]
   * measure 3 s again even if the tracker re-calibrates meanwhile on a dancer still standing at the phone.
   */
  requestRecalibration(): void {
    this.session.recalibrate();
    this.mustCalibrate = true;
  }

  /** The dance-start 'recalibrate' action: reset the tracker for the 3 s measurement now (clears the owed one). */
  recalibrate(): void {
    this.session.recalibrate();
    this.mustCalibrate = false;
  }

  handlePose(e: PoseEvent): void {
    const music = this.music?.() ?? { position: 0, playing: false };
    const musicT = frameMusicTime(music.position, e.ageMs, e.emitWallMs, this.wallNow());
    const pose = poseFromEvent(e);
    this.lastTMs = e.tMs;
    this.session.perf.captureFrom = e.captureFrom;
    if (!pose) this.pending.pose = null; // nobody in view: clear the skeleton
    this.session.step(e.tMs, pose, e.aspect, { playing: music.playing, musicT }, { captureMs: e.latencyMs, sourceFrames: e.seq });
    this.set({ playing: music.playing, count: countInEight(this.plan, musicT) });
  }

  handleEngine(e: { model: string; delegate: string }): void {
    this.session.setEngine(e.model, e.delegate);
    this.set({ engine: { model: e.model, delegate: e.delegate } }, true);
  }

  handleError(message: string): void {
    this.session.recordError(this.lastTMs);
    this.set({ error: message }, true);
  }

  private onMessage(m: OutMessage): void {
    if (!('type' in m)) {
      this.pending.usage = { ...(this.pending.usage ?? this.view.usage), [m.window]: m };
    } else if (m.type === 'status') {
      this.pending.status = m;
    } else if (m.type === 'pose') {
      this.pending.pose = m;
    } else if (m.type === 'perf') {
      this.pending.perf = m;
    } else {
      this.pending.cue = { t: m.t, kind: m.kind, target: m.target, text: m.text };
      this.cueAtMs = this.wallNow();
    }
  }

  /** Merge into the view; notify at most app.view_hz times a second unless forced. */
  private set(patch: Partial<TrackingView>, force = false): void {
    Object.assign(this.pending, patch);
    const now = this.wallNow();
    if (!force && now - this.lastFlush < 1000 / this.cfg.app.view_hz) return;
    let view: TrackingView = { ...this.view, ...this.pending };
    if (view.cue && now - this.cueAtMs >= 1000 * this.cfg.app.cue_show_s) view = { ...view, cue: null };
    this.view = view;
    this.pending = {};
    this.lastFlush = now;
    for (const listener of this.listeners) listener();
  }
}