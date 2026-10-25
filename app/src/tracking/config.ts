import type { Segment } from './types';

export type LevelThresholds = { low: number; high: number; arms_up_margin: number; jump_rise: number };

/**
 * Tracking thresholds. The sections shared with id403 config/default.yaml keep its keys and values
 * (the golden test checks them); `app` and `moves` hold values that exist only in this app.
 * Values marked (tune) are starting guesses, as in default.yaml.
 */
export type TrackingConfig = {
  pose: { num_poses: number; min_detection_confidence: number; min_presence_confidence: number; min_tracking_confidence: number; visibility_threshold: number };
  smoothing: { enabled: boolean; min_cutoff: number; beta: number; d_cutoff: number; reset_after_s: number };
  calibration: { duration_s: number; noise_floor_multiplier: number; max_noise_floor: number };
  features: { weights: { speed: number; angle: number }; max_dt_s: number; level_thresholds: LevelThresholds };
  aggregate: {
    windows: { '8count_s': number; recent_s: number };
    underused_ratio: number; min_observed_ratio: number; idle_activity: number;
    tracking_window_s: number; tracking_min_rate: number; publish_hz: number;
  };
  perf: { window_s: number; publish_hz: number };
  feedback: {
    enabled: boolean; warmup_s: number; persist_s: number; global_cooldown_s: number; target_cooldown_s: number;
    explored_min_gap_s: number; explored_watch_s: number; level_min_share: number; level_explored_share: number;
    segment_explored_ratio: number; segment_targets: Segment[];
  };
  app: {
    back_jump_s: number; // music time going back more than this starts a new 8count window (loop, seek)
    countdown_s: number; // [춤 시작] countdown to walk back from the phone
    cue_show_s: number; // a suggestion stays on screen this long
    view_hz: number; // camera tab refresh rate
    min_tracked_s: number; // sessions tracked shorter than this stay out of the analysis card
    min_bpm: number; // job.tempo outside [min_bpm, max_bpm] is ignored (fixed 4 s grid instead)
    max_bpm: number;
    max_active_gap_s: number; // longer gaps between aggregated frames (tab left, stall) add at most this much tracked time
  };
  /** Move and space detection for the analysis tab (moves.ts). Lengths are in torso lengths, angles in degrees. */
  moves: {
    smoothing: number; // weight of the new frame in the landmark average
    min_samples: number; // calibration frames needed for the standing reference
    max_dt_s: number; // a longer frame gap adds at most this much space time
    reach_ext_on: number; reach_ext_off: number; // shoulder->wrist over arm length: straight enough to start / keep a reach
    reach_min_len: number; reach_min_deg: number; // away from the body (0 deg = hanging down)
    reach_up_deg: number; reach_side_deg: number; // highest angle reached: >= up -> up, >= side -> side, else down
    reach_hold_s: number; reach_off_s: number; reach_min_s: number; reach_commit_s: number;
    circle_min_len: number; circle_window_s: number; circle_turns: number; circle_quiet_s: number;
    clap_on: number; clap_off: number; clap_gap_s: number; // wrist distance
    lift_on: number; lift_off: number; lift_big: number; lift_spread_rest: number; // ankle above the other ankle
    turn_side_ratio: number; turn_face_vis: number; turn_confirm_frames: number; turn_spin_s: number;
    max_scale_change: number; // torso length off the calibrated one by more than this: not at the spot, no space
    travel: number; // hip off the calibrated spot (a side column)
    jump_on: number; jump_off: number; // hip rise
    low_leg: number; low_leg_off: number; low_drop: number; // leg extent ratio, hip drop
    high_rise: number; high_leg: number; // the high row: hip rise, or tiptoe leg extent ratio
    lean_on_deg: number; lean_off_deg: number;
  };
};

export const DEFAULT_CONFIG: TrackingConfig = {
  pose: { num_poses: 1, min_detection_confidence: 0.5, min_presence_confidence: 0.5, min_tracking_confidence: 0.5, visibility_threshold: 0.5 },
  smoothing: { enabled: true, min_cutoff: 1.0, beta: 0.05, d_cutoff: 1.0, reset_after_s: 0.5 }, // min_cutoff, beta (tune)
  calibration: { duration_s: 3.0, noise_floor_multiplier: 2.0, max_noise_floor: 0.5 }, // multiplier, cap (tune)
  features: {
    weights: { speed: 1.0, angle: 0.5 },
    max_dt_s: 0.25,
    level_thresholds: { low: 0.75, high: 1.05, arms_up_margin: 0.1, jump_rise: 0.15 }, // (tune)
  },
  aggregate: {
    windows: { '8count_s': 4.0, recent_s: 30.0 },
    underused_ratio: 0.5,
    min_observed_ratio: 0.5, // (tune)
    idle_activity: 0.05, // (tune)
    tracking_window_s: 1.0,
    tracking_min_rate: 0.6,
    publish_hz: 10,
  },
  perf: { window_s: 5.0, publish_hz: 1 },
  feedback: {
    enabled: true,
    warmup_s: 15, persist_s: 6, global_cooldown_s: 12, target_cooldown_s: 45, // (tune)
    explored_min_gap_s: 3, explored_watch_s: 60,
    level_min_share: 0.1, level_explored_share: 0.3, segment_explored_ratio: 0.6, // (tune)
    segment_targets: ['arm_l', 'arm_r', 'leg_l', 'leg_r'], // (tune) head / torso read as quiet too often
  },
  app: { back_jump_s: 0.2, countdown_s: 5, cue_show_s: 8, view_hz: 15, min_tracked_s: 30, min_bpm: 30, max_bpm: 300, max_active_gap_s: 1 },
  moves: { // all (tune): first guesses, checked on synthetic poses and one laptop-webcam run
    smoothing: 0.55, min_samples: 10, max_dt_s: 0.25,
    reach_ext_on: 0.9, reach_ext_off: 0.85, reach_min_len: 0.55, reach_min_deg: 35, reach_up_deg: 125, reach_side_deg: 70,
    reach_hold_s: 0.5, reach_off_s: 0.25, reach_min_s: 0.1, reach_commit_s: 0.6,
    circle_min_len: 0.45, circle_window_s: 2.5, circle_turns: 0.875, circle_quiet_s: 1.0,
    clap_on: 0.3, clap_off: 0.55, clap_gap_s: 0.25,
    lift_on: 0.25, lift_off: 0.12, lift_big: 0.7, lift_spread_rest: 0.3,
    turn_side_ratio: 0.45, turn_face_vis: 0.5, turn_confirm_frames: 2, turn_spin_s: 2.5,
    max_scale_change: 0.3, travel: 0.8, jump_on: 0.2, jump_off: 0.08,
    low_leg: 0.75, low_leg_off: 0.85, low_drop: 0.5, high_rise: 0.15, high_leg: 1.08,
    lean_on_deg: 18, lean_off_deg: 10,
  },
};

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K] };

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain => !!v && typeof v === 'object' && !Array.isArray(v);
function merge(base: Plain, over: Plain): Plain {
  const out: Plain = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isPlain(v) && isPlain(base[k]) ? merge(base[k] as Plain, v) : v;
  return out;
}

/** A config with some values changed (tests, tuning). Never mutates `base`. */
export const withConfig = (over: DeepPartial<TrackingConfig>, base: TrackingConfig = DEFAULT_CONFIG): TrackingConfig =>
  merge(base as unknown as Plain, over as Plain) as unknown as TrackingConfig;

export const shareOptions = (cfg: TrackingConfig) => ({
  underusedRatio: cfg.aggregate.underused_ratio,
  minObservedRatio: cfg.aggregate.min_observed_ratio,
  idleActivity: cfg.aggregate.idle_activity,
});

/** MediaPipe detector thresholds for the pose-camera module's `detectorJson` prop. */
export const detectorJson = (cfg: TrackingConfig = DEFAULT_CONFIG): string => JSON.stringify(cfg.pose);
