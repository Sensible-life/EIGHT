// Loop speed meter -> perf message: fps, detection rate, latency percentiles (id403 perf.py).
// Time comes in as arguments (frame time tMs), so tests drive it without a clock.
import { percentile, pyRound } from './math';
import type { Percentiles, PerfMessage } from './types';

type Sample = { tMs: number; detected: boolean; captureMs: number | null; pipelineMs: number; sourceFrames: number | null };

const percentiles = (xs: number[]): Percentiles =>
  xs.length ? { p50: pyRound(percentile(xs, 50), 1), p95: pyRound(percentile(xs, 95), 1) } : { p50: null, p95: null };

export class PerfMeter {
  private samples: Sample[] = [];
  private errors: number[] = [];

  constructor(public windowS = 5.0, public model = '', public delegate = 'cpu', public captureFrom = 'read') {}

  /** One frame through the pipeline. sourceFrames = the camera's running frame counter. */
  add(tMs: number, detected: boolean, captureMs: number | null, pipelineMs: number, sourceFrames: number | null = null): void {
    this.samples.push({ tMs, detected, captureMs, pipelineMs, sourceFrames });
    this.trim(tMs);
  }

  /** A frame dropped because processing failed. */
  addError(tMs: number): void {
    this.errors.push(tMs);
    this.trim(tMs);
  }

  reset(): void {
    this.samples = [];
    this.errors = [];
  }

  snapshot(nowMs: number, stampMs: number): PerfMessage {
    this.trim(nowMs);
    const s = this.samples;
    let poseFps = 0, sourceFps = 0;
    const detectRate = s.length ? s.filter(x => x.detected).length / s.length : 0;
    if (s.length >= 2) {
      const spanS = (s[s.length - 1].tMs - s[0].tMs) / 1000;
      if (spanS > 0) {
        poseFps = (s.length - 1) / spanS;
        const first = s[0].sourceFrames, last = s[s.length - 1].sourceFrames;
        sourceFps = first !== null && last !== null ? (last - first) / spanS : poseFps;
      }
    }
    const captures = s.flatMap(x => (x.captureMs === null ? [] : [x.captureMs]));
    return {
      type: 'perf',
      t: stampMs,
      source_fps: pyRound(sourceFps, 1),
      pose_fps: pyRound(poseFps, 1),
      detect_rate: pyRound(detectRate, 3),
      lat_ms: { capture_pose: percentiles(captures), pipeline: percentiles(s.map(x => x.pipelineMs)) },
      capture_from: this.captureFrom,
      model: this.model,
      delegate: this.delegate,
      errors: this.errors.length,
    };
  }

  private trim(nowMs: number): void {
    const cut = nowMs - 1000 * this.windowS;
    while (this.samples.length && this.samples[0].tMs <= cut) this.samples.shift();
    while (this.errors.length && this.errors[0] <= cut) this.errors.shift();
  }
}
