// Per-frame body tracking: smoothing -> calibration -> segment activity + level (id403 tracker.py).
// States: "waiting" (no dancer yet) -> "calibrating" (stand still) -> "tracking".
import { Calibrator, type CalibrationResult } from './calibration';
import type { TrackingConfig } from './config';
import { jointAngles, level, normalize, segmentActivity, visibleMask } from './features';
import { OneEuroFilter, flatten, unflatten } from './smoothing';
import type { FrameResult, Landmarks, PoseFrame, Segment, TrackerState } from './types';

type Prev = { tMs: number; norm: Landmarks; angles: Record<string, number>; visible: boolean[] };

export class BodyTracker {
  state: TrackerState = 'waiting';
  calibration: CalibrationResult | null = null;
  private calibrator!: Calibrator;
  private prev: Prev | null = null;
  private lastSeen: number | null = null;
  private worldFilter!: OneEuroFilter;
  private imageFilter!: OneEuroFilter;

  constructor(private readonly cfg: TrackingConfig) {
    this.reset();
  }

  get progress(): number {
    if (this.state === 'tracking') return 1;
    return this.state === 'calibrating' ? this.calibrator.progress : 0;
  }

  /** Recalibrate from scratch. */
  reset(): void {
    this.state = 'waiting';
    this.calibration = null;
    this.calibrator = this.newCalibrator();
    this.loseTrack();
  }

  /** Feed one frame (pose null = nobody detected). Returns a result only while tracking. */
  update(tMs: number, pose: PoseFrame | null): FrameResult | null {
    const sm = this.cfg.smoothing;
    if (!pose) {
      if (this.lastSeen !== null && tMs - this.lastSeen > 1000 * sm.reset_after_s) {
        this.loseTrack();
        if (this.state === 'calibrating') {
          this.state = 'waiting';
          this.calibrator = this.newCalibrator();
        }
      }
      return this.state === 'tracking' ? { tMs, detected: false, scores: null, observed: null, level: null } : null;
    }

    this.lastSeen = tMs;
    const tS = tMs / 1000;
    const visible = visibleMask(pose, this.cfg.pose.visibility_threshold);
    let norm = normalize(pose.world), image = pose.image;
    if (sm.enabled) {
      norm = unflatten(this.worldFilter.filter(flatten(norm), tS));
      image = unflatten(this.imageFilter.filter(flatten(image), tS));
    }
    const angles = jointAngles(norm);

    let scores: Record<Segment, number> | null = null, observed: Record<Segment, boolean> | null = null;
    const prev = this.prev;
    if (prev) {
      const dt = (tMs - prev.tMs) / 1000;
      if (dt > 0 && dt <= this.cfg.features.max_dt_s) {
        const both = visible.map((v, i) => v && prev.visible[i]);
        ({ scores, observed } = segmentActivity(prev.norm, norm, prev.angles, angles, dt, both, this.cfg.features.weights, this.calibration?.noiseFloor ?? null));
      }
    }
    this.prev = { tMs, norm, angles, visible };

    if (this.state === 'waiting') this.state = 'calibrating';
    if (this.state === 'calibrating') {
      this.calibrator.add(pose, scores);
      if (this.calibrator.done) {
        this.calibration = this.calibrator.result();
        this.state = 'tracking';
      }
      return null;
    }
    const lvl = level(image, visible, this.calibration?.levelRef ?? null, this.cfg.features.level_thresholds);
    return { tMs, detected: true, scores, observed, level: lvl };
  }

  private newCalibrator(): Calibrator {
    const c = this.cfg.calibration;
    return new Calibrator({ durationS: c.duration_s, noiseFloorMultiplier: c.noise_floor_multiplier, maxNoiseFloor: c.max_noise_floor, visibilityThreshold: this.cfg.pose.visibility_threshold });
  }

  private loseTrack(): void {
    const sm = this.cfg.smoothing;
    this.prev = null;
    this.lastSeen = null;
    this.worldFilter = new OneEuroFilter(sm.min_cutoff, sm.beta, sm.d_cutoff);
    this.imageFilter = new OneEuroFilter(sm.min_cutoff, sm.beta, sm.d_cutoff);
  }
}
