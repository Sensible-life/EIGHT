export type Pulse = { t: number; strength: number };
export type HapticSource = 'bass' | 'kick' | 'both';

/** Low-band attack detector. Kick is an estimate from drums, not a separated kick stem. */
export function detectPulses(samples: Float32Array, sampleRate: number, kind: 'bass' | 'kick'): Pulse[] {
  if (!samples.length || sampleRate <= 0) return [];
  const stride = Math.max(1, Math.floor(sampleRate / 4000));
  const rate = sampleRate / stride;
  const alpha = 1 - Math.exp(-2 * Math.PI * (kind === 'kick' ? 110 : 250) / sampleRate);
  const frameSize = Math.max(1, Math.round(rate * 0.01));
  const levels: number[] = [];
  const broadband: number[] = [];
  let filtered = 0, filtered2 = 0, power = 0, count = 0, rawPower = 0, rawCount = 0;
  for (let i = 0; i < samples.length; i++) {
    // Filter before decimation so high hats cannot alias into the kick band.
    rawPower += samples[i] * samples[i]; rawCount++;
    filtered += alpha * (samples[i] - filtered);
    filtered2 += alpha * (filtered - filtered2);
    if (i % stride !== 0) continue;
    power += filtered2 * filtered2;
    if (++count === frameSize) { levels.push(Math.sqrt(power / count)); broadband.push(Math.sqrt(rawPower / rawCount)); power = 0; count = 0; rawPower = 0; rawCount = 0; }
  }
  let peak = 0;
  for (const value of levels) peak = Math.max(peak, value);
  if (peak < 0.002) return [];
  // Smooth ~50ms to reject the waveform's own oscillations as false beats.
  const smoothed = levels.map((_, i) => {
    let sum = 0;
    for (let j = Math.max(0, i - 4); j <= i; j++) sum += levels[j] * levels[j];
    return Math.sqrt(sum / 5);
  });
  const attacks = smoothed.map((value, i) => Math.max(0, value - (smoothed[i - 2] ?? 0)));
  const pulses: Pulse[] = [];
  let last = -1;
  for (let i = 1; i < attacks.length - 1; i++) {
    let floor = 0;
    for (let j = Math.max(0, i - 20); j < i; j++) floor += attacks[j];
    floor /= Math.min(i, 20);
    const time = i * frameSize / rate;
    if (attacks[i] >= attacks[i - 1] && attacks[i] > attacks[i + 1] && attacks[i] > Math.max(peak * 0.06, floor * 2.5) && smoothed[i] > peak * 0.08 && smoothed[i] > broadband[i] * 0.15 && time - last >= 0.14) {
      pulses.push({ t: time, strength: Math.min(1, attacks[i] / peak * 2) });
      last = time;
    }
  }
  return pulses;
}

export function selectPulses(bass: Pulse[], kick: Pulse[], source: HapticSource, threshold: number): Pulse[] {
  const selected = (source === 'bass' ? bass : source === 'kick' ? kick : [...bass, ...kick])
    .filter(p => Number.isFinite(p.t) && p.t >= 0 && p.strength >= threshold).sort((a, b) => a.t - b.t);
  const result: Pulse[] = [];
  for (const pulse of selected) {
    const previous = result[result.length - 1];
    if (previous && pulse.t - previous.t < 0.14) previous.strength = Math.max(previous.strength, pulse.strength);
    else result.push({ ...pulse });
  }
  return result;
}

export function encodePattern(pulses: Pulse[], duration: number): string {
  const pattern = JSON.stringify({ version: 1, durationMs: Math.round(duration * 1000), pulses: pulses.map(p => [Math.round(p.t * 1000), Math.round(p.strength * 255)]) });
  if (pattern.length > 80000) throw new Error('진동 패턴이 너무 길어요. 민감도를 낮춰 주세요.');
  return pattern;
}
