// Live pipeline: PoseFrame stream -> status / usage / feedback (id403 pipeline.py).
//   tracker (smoothing, calibration, activity, level) -> accumulator (windows) -> feedback engine
// Aggregation and suggestions run only while the music plays (ctx.playing). The tracker keeps running,
// so the camera tab still shows the dancer and can calibrate while paused.
import type { TrackingConfig } from './config';
import { FeedbackEngine } from './feedback';
import { pyRound } from './math';
import { BodyTracker } from './tracker';
import { UsageAccumulator } from './usage';
import type { EightPlan } from './windows';
import type { FeedbackCue, OutMessage, PoseFrame, StatusMessage, UsageMessage, WindowName } from './types';

export const WINDOWS: WindowName[] = ['8count', 'recent', 'session'];
export type Tick = { status: StatusMessage; usage: Partial<Record<WindowName, UsageMessage>>; cue: FeedbackCue | null };
export type StepContext = { playing: boolean; musicT: number | null };
export const ALWAYS_PLAYING: StepContext = { playing: true, musicT: null };

/** In send order: status, usage windows, then the cue (if any). */
export function tickMessages(tick: Tick): OutMessage[] {
  const out: OutMessage[] = [tick.status];
  for (const w of WINDOWS) {
    const u = tick.usage[w];
    if (u) out.push(u);
  }
  if (tick.cue) out.push({ type: 'feedback', ...tick.cue });
  return out;
}

export class LivePipeline {
  readonly tracker: BodyTracker;
  readonly accumulator: UsageAccumulator;
  readonly engine: FeedbackEngine;
  private readonly publishMs: number;
  private readonly maxGapMs: number;
  private nextPub: number | null = null;
  private sessionStart: number | null = null;
  private active = 0; // aggregation clock: advances only between frames aggregated back to back
  private lastAggT: number | null = null;

  constructor(cfg: TrackingConfig, plan: EightPlan = { kind: 'rolling', ms: 1000 * cfg.aggregate.windows['8count_s'] }) {
    const agg = cfg.aggregate;
    this.tracker = new BodyTracker(cfg);
    this.accumulator = new UsageAccumulator({
      recentMs: 1000 * agg.windows.recent_s,
      underusedRatio: agg.underused_ratio,
      minObservedRatio: agg.min_observed_ratio,
      idleActivity: agg.idle_activity,
      trackingWindowMs: 1000 * agg.tracking_window_s,
      trackingMinRate: agg.tracking_min_rate,
      backJumpS: cfg.app.back_jump_s,
    }, plan);
    this.engine = new FeedbackEngine(cfg.feedback);
    this.publishMs = 1000 / agg.publish_hz;
    this.maxGapMs = 1000 * cfg.app.max_active_gap_s;
  }

  get activeMs(): number {
    return this.active;
  }

  /** New session: recalibrate, forget usage, restart the feedback warm-up. */
  reset(): void {
    this.tracker.reset();
    this.accumulator.reset();
    this.engine.reset();
    this.sessionStart = null;
    this.active = 0;
    this.lastAggT = null;
  }

  /** Recalibrate only; the session's usage stays. */
  recalibrate(): void {
    this.tracker.reset();
    this.lastAggT = null;
  }

  setPlan(plan: EightPlan): void {
    this.accumulator.setPlan(plan);
  }

  step(tMs: number, pose: PoseFrame | null, ctx: StepContext = ALWAYS_PLAYING, stampMs?: number): Tick | null {
    const res = this.tracker.update(tMs, pose);
    if (res && ctx.playing) {
      if (this.sessionStart === null) this.sessionStart = tMs;
      // a longer gap (camera tab left while the music plays, a stall) counts as at most max_active_gap_s
      if (this.lastAggT !== null) this.active += Math.min(tMs - this.lastAggT, this.maxGapMs);
      this.lastAggT = tMs;
      this.accumulator.add(res, this.active, ctx.musicT);
    } else {
      this.lastAggT = null; // a pause (or no tracking) does not count as tracked time
    }

    if (this.nextPub !== null && tMs < this.nextPub) return null;
    this.nextPub = tMs + this.publishMs;
    const stamp = stampMs ?? Date.now();
    const tracking = this.tracker.state === 'tracking', start = this.sessionStart;
    const status: StatusMessage = {
      type: 'status',
      t: stamp,
      state: this.tracker.state,
      progress: pyRound(this.tracker.progress, 3),
      session_s: pyRound(tracking && start !== null ? (tMs - start) / 1000 : 0, 1),
    };
    const tick: Tick = { status, usage: {}, cue: null };
    if (tracking)
      for (const w of WINDOWS) {
        const msg = this.accumulator.snapshot(w, { activeMs: this.active, tMs }, stamp);
        tick.usage[w] = msg;
        if (!ctx.playing) continue;
        const cue = this.engine.update(msg, tMs);
        if (cue && !tick.cue) tick.cue = { ...cue, t: stamp };
      }
    return tick;
  }
}
