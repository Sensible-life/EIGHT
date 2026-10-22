// One live session: frame in -> every outgoing message (id403 session.py, without client commands).
//   pose message -> LivePipeline (status / usage / feedback) -> perf (1 Hz)
// Alongside, MoveDetector counts moves and space for the analysis tab; it sends no messages.
// The app keeps one per practice session; exportTracking() is what gets saved with it.
import type { TrackingConfig } from './config';
import { pyRound } from './math';
import { MoveDetector } from './moves';
import { PerfMeter } from './perf';
import { ALWAYS_PLAYING, LivePipeline, tickMessages, type StepContext, type Tick } from './pipeline';
import type { EightPlan } from './windows';
import type { FeedbackCue, OutMessage, PoseFrame, PoseMessage, SessionTracking } from './types';

export type SessionOptions = {
  model?: string;
  delegate?: string;
  captureFrom?: string;
  clockMs?: () => number; // message timestamps (epoch ms)
  perfNowMs?: () => number; // pipeline step timing (performance.now in the app)
  plan?: EightPlan;
};
export type FrameExtra = { captureMs?: number | null; sourceFrames?: number | null };

/** Landmarks for drawing. Never video (principle 3). */
export const poseMessage = (pose: PoseFrame, aspect: number, stampMs: number): PoseMessage => ({
  type: 'pose',
  t: stampMs,
  aspect: pyRound(aspect, 3),
  lm: pose.image.map((p, i) => [pyRound(p[0], 3), pyRound(p[1], 3), pyRound(pose.visibility[i], 3)]),
});

export class LiveSession {
  readonly pipeline: LivePipeline;
  readonly perf: PerfMeter;
  readonly moves: MoveDetector;
  lastTick: Tick | null = null;
  lastCue: FeedbackCue | null = null;
  private readonly perfEveryMs: number;
  private nextPerf: number | null = null;
  private trackedBase = 0;
  private readonly clock: () => number;
  private readonly perfNow: () => number;

  constructor(cfg: TrackingConfig, private readonly publish: (m: OutMessage) => void = () => {}, o: SessionOptions = {}) {
    this.pipeline = new LivePipeline(cfg, o.plan);
    this.moves = new MoveDetector(cfg);
    this.perf = new PerfMeter(cfg.perf.window_s, o.model ?? '', o.delegate ?? 'cpu', o.captureFrom ?? 'analyzer');
    this.perfEveryMs = 1000 / cfg.perf.publish_hz;
    this.clock = o.clockMs ?? (() => Date.now());
    this.perfNow = o.perfNowMs ?? (() => Date.now());
  }

  /** New session: recalibrate and forget usage, including imported totals. */
  reset(): void {
    this.pipeline.reset();
    this.moves.reset();
    this.lastTick = this.lastCue = null;
    this.trackedBase = 0;
  }

  /** Measure the standing pose again; the session's totals stay. */
  recalibrate(): void {
    this.pipeline.recalibrate();
    this.moves.recalibrate();
  }

  setPlan(plan: EightPlan): void {
    this.pipeline.setPlan(plan);
  }

  /** Model / delegate changed (GPU fallback): relabel perf and recalibrate, since tracking changes with it. */
  setEngine(model: string, delegate: string): void {
    if (model === this.perf.model && delegate === this.perf.delegate) return;
    this.perf.model = model;
    this.perf.delegate = delegate;
    this.perf.reset();
    this.recalibrate();
  }

  recordError(tMs: number): void {
    this.perf.addError(tMs);
  }

  /** Feed one frame (pose null = nobody detected). aspect = frame width / height. */
  step(tMs: number, pose: PoseFrame | null, aspect: number | null, ctx: StepContext = ALWAYS_PLAYING, extra: FrameExtra = {}): Tick | null {
    const stamp = this.clock();
    if (pose && aspect) this.publish(poseMessage(pose, aspect, stamp));
    const t0 = this.perfNow();
    const tick = this.pipeline.step(tMs, pose, ctx, stamp);
    const state = this.pipeline.tracker.state;
    this.moves.update(tMs, pose, aspect, state, ctx.playing && state === 'tracking');
    this.perf.add(tMs, pose !== null, extra.captureMs ?? null, this.perfNow() - t0, extra.sourceFrames ?? null);
    if (tick) {
      this.lastTick = tick;
      if (tick.cue) this.lastCue = tick.cue;
      for (const m of tickMessages(tick)) this.publish(m);
    }
    if (this.nextPerf === null || tMs >= this.nextPerf) {
      this.nextPerf = tMs + this.perfEveryMs;
      this.publish(this.perf.snapshot(tMs, stamp));
    }
    return tick;
  }

  /** What gets saved with the practice session: tracked time and running sums, never landmarks. */
  exportTracking(): SessionTracking {
    return {
      version: 1, trackedMs: Math.round(this.trackedBase + this.pipeline.activeMs), totals: this.pipeline.accumulator.exportTotals(),
      ...(this.moves.measured && { moves: this.moves.exportTotals() }),
    };
  }

  /** Continue a saved session's totals (resume). Call before the first frame. */
  importTracking(saved: SessionTracking): void {
    this.pipeline.accumulator.importTotals(saved.totals);
    if (saved.moves) this.moves.importTotals(saved.moves);
    this.trackedBase = saved.trackedMs;
  }
}
