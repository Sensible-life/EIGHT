// Korean cue phrases (id403 feedback/phrases.py): an observation + an open suggestion, never how to move.
// Comma phrasing avoids Korean particle agreement (이/가, 을/를) with the inserted label.
import type { CueKind, CueTarget, Segment } from './types';

export const SEGMENT_LABELS: Record<Segment, string> = { head: '머리', torso: '몸통', arm_l: '왼팔', arm_r: '오른팔', leg_l: '왼다리', leg_r: '오른다리' };
export const LEVEL_LABELS: Record<'low' | 'high', string> = { low: '낮은 높이', high: '높은 곳' };

const TEMPLATES: Record<string, string[]> = {
  segment_unexplored: ['{name}, 아직 조용해요. 한번 깨워볼까요?', '{name} 쪽은 아직 안 가봤어요. 한번 써볼까요?', '{name}, 이번 에잇에 한번 써볼까요?'],
  'level_unexplored:low': ['낮은 높이는 아직 안 가봤어요. 한번 내려가볼까요?', '바닥 가까이, 한번 가볼까요?'],
  'level_unexplored:high': ['높은 곳은 아직 비어 있어요. 한번 올라가볼까요?', '위쪽 공간, 한번 써볼까요?'],
  'explored:segment': ['{name}, 움직이기 시작했어요', '{name}, 새로 열렸어요'],
  'explored:low': ['낮은 높이, 가봤네요', '바닥 가까이, 다녀왔네요'],
  'explored:high': ['높은 곳, 가봤네요', '위쪽 공간, 열렸네요'],
};

export const label = (target: CueTarget): string =>
  target in SEGMENT_LABELS ? SEGMENT_LABELS[target as Segment] : LEVEL_LABELS[target as 'low' | 'high'] ?? target;

/** Rotates through the templates of each kind so repeated cues don't sound canned. */
export class Phrasebook {
  private next = new Map<string, number>();

  text(kind: CueKind, target: CueTarget): string {
    const key = kind === 'segment_unexplored' ? kind : kind === 'explored' && target in SEGMENT_LABELS ? 'explored:segment' : `${kind}:${target}`;
    const options = TEMPLATES[key], i = this.next.get(key) ?? 0;
    this.next.set(key, i + 1);
    return options[i % options.length].replace('{name}', label(target));
  }
}
