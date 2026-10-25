// [춤 시작]: a countdown to walk back from the phone, a 3 s still calibration if needed, then the music.
import type { TrackerState } from './types';

export type StartPhase =
  | { kind: 'idle' }
  | { kind: 'countdown'; endsAtMs: number; calibrate: boolean }
  | { kind: 'calibrating' };
export type StartAction = 'recalibrate' | 'play';
export type StartEvent =
  | { type: 'press'; nowMs: number; calibrated: boolean; countdownMs: number }
  | { type: 'tick'; nowMs: number; state: TrackerState; playing: boolean }
  | { type: 'cancel' };

export const IDLE: StartPhase = { kind: 'idle' };

export function nextStart(phase: StartPhase, ev: StartEvent): { phase: StartPhase; actions: StartAction[] } {
  const stay = { phase, actions: [] as StartAction[] };
  if (ev.type === 'cancel') return { phase: IDLE, actions: [] };
  if (ev.type === 'press')
    return phase.kind === 'idle' ? { phase: { kind: 'countdown', endsAtMs: ev.nowMs + ev.countdownMs, calibrate: !ev.calibrated }, actions: [] } : stay;
  if (phase.kind === 'idle') return stay;
  if (ev.playing) return { phase: IDLE, actions: [] }; // started from the dock: never play twice
  if (phase.kind === 'countdown') {
    if (ev.nowMs < phase.endsAtMs) return stay;
    return phase.calibrate ? { phase: { kind: 'calibrating' }, actions: ['recalibrate'] } : { phase: IDLE, actions: ['play'] };
  }
  return ev.state === 'tracking' ? { phase: IDLE, actions: ['play'] } : stay;
}

export const secondsLeft = (phase: StartPhase, nowMs: number): number =>
  phase.kind === 'countdown' ? Math.max(0, Math.ceil((phase.endsAtMs - nowMs) / 1000)) : 0;