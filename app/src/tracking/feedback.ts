// Decides *when* to say *what*: UsageMessage stream -> occasional FeedbackCue (id403 feedback/engine.py).
// Unexplored parts / levels are judged on the "recent" window and must hold for persist_s; "explored" is
// judged on the "8count" window so the dancer hears it within seconds. Warm-up, cooldowns and silence while
// tracking is lost or the body is idle keep it from nagging. Time comes only from nowMs.
import type { TrackingConfig } from './config';
import { Phrasebook } from './phrases';
import { SEGMENT_NAMES } from './segments';
import type { CueKind, CueTarget, FeedbackCue, Level, Segment, UsageMessage } from './types';

const SEGMENT = 'segment_unexplored', LEVEL = 'level_unexplored';
type Unexplored = typeof SEGMENT | typeof LEVEL;
const CUED_LEVELS = ['low', 'high'] as const; // mid is everyone's default; not suggested
/**
 * Order used to break ties between targets with equal usage share: levels first (low before high),
 * then limbs before head / torso. Shared with the insights so both pick the same target when shares tie.
 */
export const TIE_ORDER: CueTarget[] = ['low', 'high', 'leg_l', 'leg_r', 'arm_l', 'arm_r', 'torso', 'head'];

const keyOf = (kind: Unexplored, target: CueTarget) => `${kind}|${target}`;
const parse = (key: string) => {
  const [kind, target] = key.split('|');
  return { kind: kind as Unexplored, target: target as CueTarget };
};
const shareOf = (msg: UsageMessage, key: string) => {
  const { kind, target } = parse(key);
  return kind === SEGMENT ? msg.segments[target as Segment] ?? 0 : msg.level[target as Level] ?? 0;
};
const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

export class FeedbackEngine {
  private start: number | null = null;
  private since = new Map<string, number>(); // unexplored condition -> first seen
  private lastCue: number | null = null;
  private lastKind: Unexplored | null = null; // for alternation
  private targetLast = new Map<CueTarget, number>();
  private watch = new Map<string, number>(); // cued condition -> cue time (insertion order matters)
  private phrases = new Phrasebook();
  private readonly segmentExploredShare: number;
  private readonly targets: Set<Segment>;

  constructor(private readonly cfg: TrackingConfig['feedback']) {
    this.segmentExploredShare = cfg.segment_explored_ratio / SEGMENT_NAMES.length;
    this.targets = new Set(cfg.segment_targets.length ? cfg.segment_targets : SEGMENT_NAMES);
  }

  reset(): void {
    this.start = null;
    this.since.clear();
    this.lastCue = null;
    this.lastKind = null;
    this.targetLast.clear();
    this.watch.clear();
    this.phrases = new Phrasebook();
  }

  update(msg: UsageMessage, nowMs: number): FeedbackCue | null {
    if (!this.cfg.enabled) return null;
    if (this.start === null) this.start = nowMs;
    if (msg.window === 'recent') return this.unexplored(msg, nowMs, this.start);
    if (msg.window === '8count') return this.explored(msg, nowMs);
    return null;
  }

  private unexplored(msg: UsageMessage, now: number, start: number): FeedbackCue | null {
    if (!msg.tracking_ok || sum(msg.segments) <= 0) {
      this.since.clear();
      return null;
    }
    const holding = msg.underused.filter(s => this.targets.has(s)).map(s => keyOf(SEGMENT, s));
    if (sum(msg.level) > 0) // level judged at all
      for (const lv of CUED_LEVELS) if ((msg.level[lv] ?? 0) < this.cfg.level_min_share) holding.push(keyOf(LEVEL, lv));
    this.since = new Map(holding.map(k => [k, this.since.get(k) ?? now]));

    const ms = (s: number) => 1000 * s;
    if (now - start < ms(this.cfg.warmup_s) || !this.gapOk(now, ms(this.cfg.global_cooldown_s))) return null;
    const targetCd = ms(this.cfg.target_cooldown_s);
    const ready = [...this.since]
      .filter(([k, t0]) => now - t0 >= ms(this.cfg.persist_s) && now - (this.targetLast.get(parse(k).target) ?? -targetCd) >= targetCd)
      .map(([k]) => k);
    if (!ready.length) return null;

    const prefer: Unexplored = this.lastKind === LEVEL ? SEGMENT : LEVEL; // alternate, level first
    const preferred = ready.filter(k => parse(k).kind === prefer);
    const group = preferred.length ? preferred : ready;
    const rank = (k: string): [number, number] => [shareOf(msg, k), TIE_ORDER.indexOf(parse(k).target)];
    const best = group.reduce((a, b) => {
      const [sa, ta] = rank(a), [sb, tb] = rank(b);
      return sb < sa || (sb === sa && tb < ta) ? b : a;
    });
    const { kind, target } = parse(best);
    this.lastKind = kind;
    this.targetLast.set(target, now);
    this.watch.set(best, now);
    this.since.delete(best);
    return this.emit(kind, target, now);
  }

  private explored(msg: UsageMessage, now: number): FeedbackCue | null {
    const watchMs = 1000 * this.cfg.explored_watch_s;
    this.watch = new Map([...this.watch].filter(([, t]) => now - t <= watchMs));
    if (!msg.tracking_ok || !this.gapOk(now, 1000 * this.cfg.explored_min_gap_s)) return null;
    for (const key of [...this.watch.keys()]) {
      const { kind, target } = parse(key);
      const reached = kind === SEGMENT
        ? (msg.segments[target as Segment] ?? 0) >= this.segmentExploredShare
        : (msg.level[target as Level] ?? 0) >= this.cfg.level_explored_share;
      if (reached) {
        this.watch.delete(key);
        return this.emit('explored', target, now);
      }
    }
    return null;
  }

  private gapOk(now: number, gapMs: number): boolean {
    return this.lastCue === null || now - this.lastCue >= gapMs;
  }

  private emit(kind: CueKind, target: CueTarget, now: number): FeedbackCue {
    this.lastCue = now;
    return { t: now, kind, target, text: this.phrases.text(kind, target) };
  }
}
