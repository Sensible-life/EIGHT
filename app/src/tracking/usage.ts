// Usage windows: segment activity + level -> UsageMessage (id403 aggregate/usage.py).
// Windows: 8count (the song's current eight, or id403's rolling 4 s), recent (30 s of tracked time),
// session (everything, including totals restored from a saved session).
// A segment's activity is averaged over the frames where it was *observed*, so an occluded limb is
// neither diluted nor reported as unused (principle 4).
import { pyRound } from './math';
import { LEVELS, SEGMENT_NAMES, byLevel, bySegment } from './segments';
import { eightKey, type EightPlan } from './windows';
import type { FrameResult, Level, Segment, UsageMessage, UsageTotals, WindowName } from './types';

export const emptyTotals = (): UsageTotals => ({ frames: 0, score: bySegment(() => 0), observed: bySegment(() => 0), levels: byLevel(() => 0) });

export function addToTotals(t: UsageTotals, r: FrameResult): void {
  t.frames += 1;
  if (r.level) t.levels[r.level] += 1;
  if (!r.scores || !r.observed) return;
  for (const s of SEGMENT_NAMES) if (r.observed[s]) { t.observed[s] += 1; t.score[s] += r.scores[s] ?? 0; }
}

export const mergeTotals = (a: UsageTotals, b: UsageTotals): UsageTotals => ({
  frames: a.frames + b.frames,
  score: bySegment(s => a.score[s] + b.score[s]),
  observed: bySegment(s => a.observed[s] + b.observed[s]),
  levels: byLevel(l => a.levels[l] + b.levels[l]),
});

export type ShareOptions = { underusedRatio: number; minObservedRatio: number; idleActivity: number };
export type Shares = { segments: Record<Segment, number>; level: Record<Level, number>; underused: Segment[] };

/** Shares (unrounded) and underused parts. A part seen in fewer than min_observed_ratio of the frames is never underused. */
export function snapshotFromTotals(t: UsageTotals, o: ShareOptions): Shares {
  const rates = bySegment(s => (t.observed[s] ? t.score[s] / t.observed[s] : 0));
  const total = SEGMENT_NAMES.reduce((sum, s) => sum + rates[s], 0);
  let segments = bySegment(() => 0), underused: Segment[] = [];
  if (total >= o.idleActivity) {
    segments = bySegment(s => rates[s] / total);
    const limit = o.underusedRatio / SEGMENT_NAMES.length, minObs = o.minObservedRatio * t.frames;
    underused = SEGMENT_NAMES.filter(s => segments[s] < limit && t.observed[s] >= minObs);
  }
  const nLvl = LEVELS.reduce((sum, l) => sum + t.levels[l], 0);
  return { segments, level: byLevel(l => (nLvl ? t.levels[l] / nLvl : 0)), underused };
}

export type AccumulatorOptions = ShareOptions & { recentMs: number; trackingWindowMs: number; trackingMinRate: number; backJumpS: number };
type Sample = FrameResult & { activeMs: number };

export class UsageAccumulator {
  private samples: Sample[] = [];
  private session = emptyTotals();
  private base = emptyTotals(); // restored from a saved session
  private eight: { key: number | null; totals: UsageTotals } | null = null;
  private lastMusicT: number | null = null;

  constructor(private readonly o: AccumulatorOptions, private plan: EightPlan) {}

  get currentEightKey(): number | null {
    return this.eight?.key ?? null;
  }

  /** New session: forget everything, including restored totals. */
  reset(): void {
    this.samples = [];
    this.session = emptyTotals();
    this.base = emptyTotals();
    this.closeEight();
  }

  setPlan(plan: EightPlan): void {
    this.plan = plan;
    this.closeEight();
  }

  /** One tracked frame. activeMs = aggregation clock; musicT = song position (s) for song-aligned eights. */
  add(r: FrameResult, activeMs: number, musicT: number | null = null): void {
    this.samples.push({ ...r, activeMs });
    addToTotals(this.session, r);
    const keep = Math.max(this.o.recentMs, this.o.trackingWindowMs, this.plan.kind === 'rolling' ? this.plan.ms : 0);
    while (this.samples.length && this.samples[0].activeMs <= activeMs - keep) this.samples.shift();
    if (this.plan.kind !== 'rolling' && musicT !== null) {
      const key = eightKey(this.plan, musicT);
      const back = this.lastMusicT !== null && musicT < this.lastMusicT - this.o.backJumpS;
      if (!this.eight || this.eight.key !== key || back) this.eight = { key, totals: emptyTotals() };
      addToTotals(this.eight.totals, r);
      this.lastMusicT = musicT;
    }
  }

  snapshot(window: WindowName, now: { activeMs: number; tMs: number }, stampMs?: number): UsageMessage {
    const { segments, level, underused } = snapshotFromTotals(this.windowTotals(window, now.activeMs), this.o);
    const last = this.samples[this.samples.length - 1];
    return {
      t: stampMs ?? now.tMs,
      window,
      segments: bySegment(s => pyRound(segments[s], 4)),
      level: byLevel(l => pyRound(level[l], 4)),
      current_level: last ? last.level : null,
      underused,
      tracking_ok: this.trackingOk(now.tMs),
    };
  }

  exportTotals(): UsageTotals {
    return mergeTotals(this.base, this.session);
  }

  importTotals(t: UsageTotals): void {
    this.base = mergeTotals(emptyTotals(), t);
  }

  private closeEight(): void {
    this.eight = null;
    this.lastMusicT = null;
  }

  private windowTotals(window: WindowName, nowActiveMs: number): UsageTotals {
    if (window === 'session') return mergeTotals(this.base, this.session);
    if (window === '8count' && this.plan.kind !== 'rolling') return this.eight?.totals ?? emptyTotals();
    const span = window === 'recent' ? this.o.recentMs : this.plan.kind === 'rolling' ? this.plan.ms : 0;
    const t = emptyTotals();
    for (const s of this.samples) if (s.activeMs > nowActiveMs - span) addToTotals(t, s);
    return t;
  }

  /** Was the dancer detected steadily in the last tracking window of camera time? */
  private trackingOk(nowTMs: number): boolean {
    const recent = this.samples.filter(s => s.tMs > nowTMs - this.o.trackingWindowMs);
    if (!recent.length) return false;
    return recent.filter(s => s.detected).length / recent.length >= this.o.trackingMinRate;
  }
}
