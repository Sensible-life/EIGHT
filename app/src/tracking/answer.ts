// Saying yes to the display's question without hands: both arms make an O over the head and hold it.
// Counted only while the question is up, and only for an O started after it appeared: an O held from before
// (or held on after a yes) must come down and go up again. Image coords, y down; x is scaled by the aspect.
import { DEFAULT_CONFIG, type TrackingConfig } from './config';
import type { PoseFrame } from './types';

type Cfg = TrackingConfig['answer'];
const NOSE = 0, SHOULDER = [11, 12], ELBOW = [13, 14], WRIST = [15, 16], HIP = [23, 24];
const NEEDED = [NOSE, ...SHOULDER, ...ELBOW, ...WRIST, ...HIP];

/** Both wrists above the head and close together, both elbows above the shoulders and out wider than the wrists. */
export function isOverheadO(pose: PoseFrame, aspect: number, cfg: Cfg): boolean {
  if (NEEDED.some(i => !(pose.visibility[i] >= cfg.visibility))) return false;
  const p = (i: number) => [pose.image[i][0] * aspect, pose.image[i][1]] as const;
  const mid = (a: number, b: number) => [(p(a)[0] + p(b)[0]) / 2, (p(a)[1] + p(b)[1]) / 2] as const;
  const shoulders = mid(SHOULDER[0], SHOULDER[1]), hips = mid(HIP[0], HIP[1]);
  const T = Math.hypot(shoulders[0] - hips[0], shoulders[1] - hips[1]);
  if (!(T > 1e-4)) return false;
  const headTop = p(NOSE)[1] - cfg.head_top * T;
  const [wl, wr] = WRIST.map(p), [el, er] = ELBOW.map(p), [sl, sr] = SHOULDER.map(p);
  const out = (q: readonly [number, number]) => Math.abs(q[0] - shoulders[0]);
  return wl[1] < headTop && wr[1] < headTop
    && Math.hypot(wl[0] - wr[0], wl[1] - wr[1]) <= cfg.wrist_gap * T
    && el[1] < sl[1] && er[1] < sr[1]
    && out(el) > out(wl) && out(er) > out(wr);
}

export class OverheadAnswer {
  private armed = false; // a frame without the O was seen while asking
  private since: number | null = null; // when the current O began

  constructor(private readonly cfg: Cfg = DEFAULT_CONFIG.answer) {}

  reset(): void {
    this.armed = false;
    this.since = null;
  }

  /** One frame; `yes` is true once, on the frame the hold reaches hold_s. `progress` (0..1) is for the on-screen ring. */
  update(pose: PoseFrame | null, aspect: number, asking: boolean, tMs: number): { progress: number; yes: boolean } {
    if (!asking) {
      this.reset();
      return { progress: 0, yes: false };
    }
    const o = pose !== null && isOverheadO(pose, aspect, this.cfg);
    if (!o) {
      this.since = null;
      if (pose !== null) this.armed = true;
      return { progress: 0, yes: false };
    }
    if (!this.armed) return { progress: 0, yes: false };
    if (this.since === null) this.since = tMs;
    const held = (tMs - this.since) / 1000;
    if (held >= this.cfg.hold_s) {
      this.reset();
      return { progress: 1, yes: true };
    }
    return { progress: held / this.cfg.hold_s, yes: false };
  }
}
