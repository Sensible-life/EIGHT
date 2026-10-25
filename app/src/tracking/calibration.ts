// Calibration: the dancer stands still for duration_s at session start (id403 calibration.py).
// Measures the per-segment noise floor (activity while still), torso length, and the standing
// leg geometry used as the reference for body level.
import { legGeometry, torsoLength, visibleMask, type LevelRef } from './features';
import { median } from './math';
import { SEGMENT_NAMES, bySegment } from './segments';
import type { PoseFrame, Segment } from './types';

export type CalibrationResult = { noiseFloor: Record<Segment, number>; torsoLength: number; levelRef: LevelRef | null };
export type CalibratorOptions = { durationS: number; noiseFloorMultiplier: number; maxNoiseFloor: number; visibilityThreshold: number };

export class Calibrator {
  private t0: number | null = null;
  private tLast: number | null = null;
  private raw = bySegment<number[]>(() => []);
  private torso: number[] = [];
  private geo: [number, number, number][] = [];

  constructor(private readonly o: CalibratorOptions) {}

  /** rawActivity = segment scores without a noise floor (null for the first frame). */
  add(pose: PoseFrame, rawActivity: Record<Segment, number> | null): void {
    if (this.t0 === null) this.t0 = pose.tMs;
    this.tLast = pose.tMs;
    if (rawActivity) for (const s of SEGMENT_NAMES) this.raw[s].push(rawActivity[s] ?? 0);
    this.torso.push(torsoLength(pose.world));
    const g = legGeometry(pose.image, visibleMask(pose, this.o.visibilityThreshold));
    if (g) this.geo.push(g);
  }

  get progress(): number {
    if (this.t0 === null || this.tLast === null) return 0;
    return Math.min((this.tLast - this.t0) / 1000 / this.o.durationS, 1);
  }

  get done(): boolean {
    return this.progress >= 1;
  }

  result(): CalibrationResult {
    const noiseFloor = bySegment(s => {
      const v = this.raw[s];
      return Math.min(v.length ? this.o.noiseFloorMultiplier * median(v) : 0, this.o.maxNoiseFloor);
    });
    const levelRef = this.geo.length
      ? { hipY: median(this.geo.map(g => g[0])), legRatio: median(this.geo.map(g => g[1])), torsoImg: median(this.geo.map(g => g[2])) }
      : null;
    return { noiseFloor, torsoLength: this.torso.length ? median(this.torso) : 0, levelRef };
  }
}
