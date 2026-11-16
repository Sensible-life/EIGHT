// Short, descriptive cues for observed and less-used movement.
import type { CueKind, CueTarget, Level, Segment } from './types';

export const SEGMENT_LABELS: Record<Segment, string> = { head: "Head", torso: "Torso", arm_l: "Left arm", arm_r: "Right arm", leg_l: "Left leg", leg_r: "Right leg" };
export const LEVEL_LABELS: Record<'low' | 'high', string> = { low: "Low height", high: "High height" };
/** Display names of the three height bands, for the level share readout. */
export const LEVEL_NAMES: Record<Level, string> = { low: "Low", mid: "Mid", high: "High" };

const TEMPLATES: Record<string, string[]> = {
  segment_unexplored: ["Less movement: {name}", "Low activity: {name}"],
  'level_unexplored:low': ["Little movement at low height"],
  'level_unexplored:high': ["Little movement at high height"],
  'explored:segment': ["Movement detected: {name}"],
  'explored:low': ["Movement detected at low height"],
  'explored:high': ["Movement detected at high height"],
};

export const label = (target: CueTarget): string =>
  target in SEGMENT_LABELS ? SEGMENT_LABELS[target as Segment] : LEVEL_LABELS[target as 'low' | 'high'] ?? target;

/** Selects a display message for each tracking cue. */
export class Phrasebook {
  private next = new Map<string, number>();

  text(kind: CueKind, target: CueTarget): string {
    const key = kind === 'segment_unexplored' ? kind : kind === 'explored' && target in SEGMENT_LABELS ? 'explored:segment' : `${kind}:${target}`;
    const options = TEMPLATES[key], i = this.next.get(key) ?? 0;
    this.next.set(key, i + 1);
    return options[i % options.length].replace('{name}', label(target));
  }
}
