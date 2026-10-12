export const JOINTS = ['leftWrist', 'rightWrist', 'leftAnkle', 'rightAnkle', 'hip'] as const;
export type Joint = typeof JOINTS[number];
export type Point = { x: number; y: number; confidence?: number };
export type Frame = { t: number; joints: Record<Joint, Point> };
export type Trace = { version: 1; source: 'sample' | 'imported'; frames: Frame[] };
export type MotionResult = { source: Trace['source']; duration: number; body: Record<Joint, number>; space: number[]; peaks: number[]; repeats: number; period: number | null; beatMatch: number | null; bpm: number; offset: number; coverage: number };
export function parseTrace(text: string): Trace {
  if (text.length > 12_000_000) throw new Error('좌표 파일은 12MB 이하로 준비해 주세요.');
  const x = JSON.parse(text);
  if (!x || x.version !== 1 || !Array.isArray(x.frames) || x.frames.length < 3 || x.frames.length > 36000) throw new Error('version:1과 3~36000개의 frames가 필요해요.');
  let previous = -1;
  for (const f of x.frames) {
    if (!f || !Number.isFinite(f.t) || f.t < 0 || f.t <= previous || f.t > 3600) throw new Error('t는 0~3600초 사이의 오름차순이어야 해요.');
    previous = f.t;
    for (const joint of JOINTS) { const p = f.joints?.[joint]; if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1 || (p.confidence !== undefined && (!Number.isFinite(p.confidence) || p.confidence < 0 || p.confidence > 1))) throw new Error(`${joint}: 정규화한 x/y(0~1)와 confidence(0~1)를 확인해 주세요.`); }
  }
  return { version: 1, source: 'imported', frames: x.frames };
}
export function sampleTrace(kind: 'balanced' | 'arms' | 'travel' = 'balanced'): Trace {
  return { version: 1, source: 'sample', frames: Array.from({ length: 601 }, (_, i) => { const t = i / 30, phase = Math.sin(t * Math.PI * 2), drift = kind === 'travel' ? Math.sin(t * .5) * .28 : Math.sin(t * .4) * .04; return { t, joints: { hip: { x: .5 + drift, y: .51 + (kind === 'travel' ? Math.sin(t * .9) * .2 : .02 * phase) }, leftWrist: { x: .3 + drift, y: .36 + phase * .13 }, rightWrist: { x: .7 + drift, y: .36 - phase * .13 }, leftAnkle: { x: .4 + drift, y: .8 + phase * (kind === 'arms' ? .004 : .05) }, rightAnkle: { x: .6 + drift, y: .8 - phase * (kind === 'arms' ? .004 : .05) } } }; }) };
}
export function analyzeTrace(trace: Trace, bpm = 120, offset = 0): MotionResult {
  if (!Number.isFinite(bpm) || bpm < 30 || bpm > 300 || !Number.isFinite(offset) || Math.abs(offset) > 10) throw new Error('BPM은 30~300, 영상 시간 보정은 ±10초 범위예요.');
  const frames = trace.frames, totals = Object.fromEntries(JOINTS.map(j => [j, 0])) as Record<Joint, number>, space = Array(9).fill(0) as number[];
  const speeds: { t: number; value: number }[] = []; let valid = 0;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i], dt = b.t - a.t;
    if (dt > .5) continue; // do not bridge tracking gaps
    let energy = 0, count = 0;
    for (const j of JOINTS) { const p = a.joints[j], q = b.joints[j]; if ((p.confidence ?? 1) < .5 || (q.confidence ?? 1) < .5) continue; const distance = Math.hypot(q.x - p.x, q.y - p.y); totals[j] += distance; energy += distance / dt; count++; }
    if (count) { valid++; speeds.push({ t: b.t, value: energy / count }); }
    if ((b.joints.hip.confidence ?? 1) >= .5) { const { x, y } = b.joints.hip; space[Math.min(2, Math.floor(y * 3)) * 3 + Math.min(2, Math.floor(x * 3))] += dt; }
  }
  const maximum = Math.max(0, ...speeds.map(s => s.value)), peaks: number[] = [];
  for (let i = 1; i < speeds.length - 1; i++) if (speeds[i].value > Math.max(.015, maximum * .55) && speeds[i].value > speeds[i - 1].value && speeds[i].value >= speeds[i + 1].value && (!peaks.length || speeds[i].t - peaks[peaks.length - 1] >= .25)) peaks.push(speeds[i].t);
  const intervals = peaks.slice(1).map((t, i) => t - peaks[i]).sort((a, b) => a - b), period = intervals.length >= 2 ? intervals[Math.floor(intervals.length / 2)] : null;
  const consistent = period ? intervals.filter(t => Math.abs(t - period) < period * .2).length : 0;
  const total = Object.values(totals).reduce((a, b) => a + b, 0), spatial = space.reduce((a, b) => a + b, 0), beat = 60 / bpm;
  return { source: trace.source, duration: frames[frames.length - 1].t - frames[0].t, body: Object.fromEntries(JOINTS.map(j => [j, total ? totals[j] / total : 0])) as Record<Joint, number>, space: space.map(v => spatial ? v / spatial : 0), peaks, repeats: consistent >= 2 ? consistent + 1 : 0, period: consistent >= 2 ? period : null, beatMatch: peaks.length ? peaks.filter(t => Math.abs((t + offset) / beat - Math.round((t + offset) / beat)) * beat <= .12).length / peaks.length : null, bpm, offset, coverage: valid / Math.max(1, frames.length - 1) };
}
