import type { FeedbackCue, TrackerState } from '../tracking/types';

export type MovementProposal = { id: string; target: FeedbackCue['target']; title: string; evidence: string };
export type AgentState = { lastOfferedAt: number | null; lastTarget: FeedbackCue['target'] | null; pending: MovementProposal | null };
export const initialAgentState = (): AgentState => ({ lastOfferedAt: null, lastTarget: null, pending: null });

/** A conservative policy around the tracking engine's already qualified cues. Times use the caller's monotonic clock. */
export function considerMovement(state: AgentState, input: { now: number; cue: FeedbackCue | null; tracking: TrackerState | null; playing: boolean; recording: boolean }): AgentState {
  const { cue, now } = input;
  if (!Number.isFinite(now) || !cue || cue.kind === 'explored' || input.tracking !== 'tracking' || !input.playing || input.recording || state.pending) return state;
  if (state.lastOfferedAt !== null && now - state.lastOfferedAt < 90000) return state;
  if (state.lastTarget === cue.target) return state;
  const titles: Record<FeedbackCue['target'], string> = { head: 'Explore a head movement', torso: 'Try a torso-led phrase', arm_l: 'Try a left-arm-led phrase', arm_r: 'Try a right-arm-led phrase', leg_l: 'Try a left-leg-led phrase', leg_r: 'Try a right-leg-led phrase', low: 'Try a lower level', high: 'Try a higher level' };
  return { lastOfferedAt: now, lastTarget: cue.target, pending: { id: `${now}-${cue.target}`, target: cue.target, title: titles[cue.target], evidence: cue.kind === 'level_unexplored' ? 'This level appeared less often in recent tracked movement.' : 'This body part appeared less active in recent tracked movement.' } };
}

export function respondToMovement(state: AgentState, id: string): AgentState {
  return state.pending?.id === id ? { ...state, pending: null } : state;
}
