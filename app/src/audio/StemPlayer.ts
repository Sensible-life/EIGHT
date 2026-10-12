import { detectPulses, Pulse } from '../haptics/pattern';
import { AudioBuffer, AudioBufferSourceNode, AudioContext, AudioManager, GainNode } from 'react-native-audio-api';

/**
 * Demucs stem 여러 개를 샘플 단위로 맞춰 동시에 재생하는 엔진.
 *
 *   source(drums) ─ gain(drums) ─┐
 *   source(bass)  ─ gain(bass)  ─┼─ master ─ destination
 *   source(...)   ─ gain(...)   ─┘
 *
 * AudioBufferSourceNode는 한 번만 start 가능하므로 play/seek/loop 변경 때마다
 * 모든 stem의 source를 새로 만들고, 같은 ctx 시각(startAt)에 함께 시작시켜 싱크를 보장한다.
 */
export type LoopRange = { start: number; end: number } | null;

export class StemPlayer {
  private ctx: AudioContext;
  private master: GainNode;
  private buffers: Record<string, AudioBuffer> = {};
  private gains: Record<string, GainNode> = {};
  private sources: AudioBufferSourceNode[] = [];
  private startCtxTime = 0;
  private startOffset = 0;
  private pausedAt = 0;
  private loop: LoopRange = null;
  private disposed = false;
  private playGeneration = 0;
  private waveforms: Record<string, number[]> = {};
  private envelopes: Record<string, number[]> = {};
  playing = false;
  duration = 0;
  onEnded?: () => void;

  constructor() {
    AudioManager.setAudioSessionOptions({ iosCategory: 'playback', iosMode: 'default', iosOptions: [] });
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
  }

  get stems() {
    return Object.keys(this.buffers);
  }

  /** stem 파일들을 받아 디코드. onProgress(완료 수, 전체 수) */
  async load(files: Record<string, string>, onProgress?: (done: number, total: number) => void) {
    const entries = Object.entries(files);
    if (!entries.length) throw new Error('재생할 레이어 파일이 없습니다.');
    if (this.disposed) throw new Error('플레이어가 종료되었습니다.');
    let done = 0;
    const buffers: Record<string, AudioBuffer> = {};
    // Decode sequentially to avoid holding several compressed files in memory at once.
    for (const [name, url] of entries) {
        const buf = await this.ctx.decodeAudioData(url);
        if (this.disposed) return;
        if (!Number.isFinite(buf.duration) || buf.duration <= 0) throw new Error(`${name}: 비어 있는 오디오입니다.`);
        buffers[name] = buf;
        onProgress?.(++done, entries.length);
    }
    const durations = Object.values(buffers).map(b => b.duration);
    if (Math.max(...durations) - Math.min(...durations) > 0.15) {
      throw new Error('레이어 길이가 서로 다릅니다. 같은 곡에서 분리한 파일을 선택해 주세요.');
    }
    this.buffers = buffers;
    for (const [name, buf] of Object.entries(buffers)) {
        const g = this.ctx.createGain();
        g.connect(this.master);
        this.gains[name] = g;
        const channel = buf.getChannelData(0);
        if (name === 'bass' || name === 'drums') this.pulsePatterns[name === 'bass' ? 'bass' : 'kick'] = detectPulses(channel, buf.sampleRate, name === 'bass' ? 'bass' : 'kick');
        // Compute meters once. Reading full native buffers on each UI tick is expensive.
        this.envelopes[name] = Array.from({ length: Math.ceil(buf.duration * 10) }, (_, i) => {
          const start = Math.floor(i * buf.sampleRate / 10);
          const end = Math.min(channel.length, Math.floor((i + 1) * buf.sampleRate / 10));
          let peak = 0;
          for (let n = start; n < end; n += 32) peak = Math.max(peak, Math.abs(channel[n]));
          return Math.min(1, peak);
        });
        this.waveforms[name] = Array.from({ length: 64 }, (_, i) => {
          const start = Math.floor(i * channel.length / 64);
          const end = Math.floor((i + 1) * channel.length / 64);
          const stride = Math.max(1, Math.floor((end - start) / 128));
          let peak = 0;
          for (let n = start; n < end; n += stride) peak = Math.max(peak, Math.abs(channel[n]));
          return peak;
        });
    }
    this.duration = Math.min(...durations);
  }

  private pulsePatterns: Record<string, Pulse[]> = {};
  pulses(kind: 'bass' | 'kick'): Pulse[] { return this.pulsePatterns[kind] ?? []; }
  get transport() {
    const position = this.position;
    return { positionMs: position * 1000, playing: this.playing, loop: this.loop ? { startMs: this.loop.start * 1000, endMs: this.loop.end * 1000 } : null,
      startDelayMs: this.playing ? Math.max(0, this.startCtxTime - this.ctx.currentTime) * 1000 : 0 };
  }

  waveform(name: string): number[] { return this.waveforms[name] ?? []; }

  levelAt(name: string, time: number): number {
    if (!this.playing) return 0;
    return this.envelopes[name]?.[Math.floor(time * 10)] ?? 0;
  }

  /** 현재 재생 위치(초) */
  get position(): number {
    if (!this.playing) return this.pausedAt;
    let p = this.startOffset + Math.max(0, this.ctx.currentTime - this.startCtxTime);
    if (this.loop && p >= this.loop.end) {
      const len = this.loop.end - this.loop.start;
      p = this.loop.start + ((p - this.loop.start) % len);
    }
    if (p >= this.duration) {
      this.stopSources();
      this.playing = false;
      this.pausedAt = 0;
      this.onEnded?.();
      return 0;
    }
    return p;
  }

  async play(from?: number) {
    if (this.disposed || !this.stems.length) return;
    const generation = ++this.playGeneration;
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (this.disposed || generation !== this.playGeneration) return;
    this.stopSources();
    let offset = Math.max(0, Math.min(from ?? this.pausedAt, Math.max(0, this.duration - 0.01)));
    if (this.loop && (offset < this.loop.start || offset >= this.loop.end)) offset = this.loop.start;
    const startAt = this.ctx.currentTime + 0.05; // 모든 stem이 같은 시각에 시작하도록 약간 앞에 예약
    for (const [name, buf] of Object.entries(this.buffers)) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      if (this.loop) {
        src.loop = true;
        src.loopStart = this.loop.start;
        src.loopEnd = this.loop.end;
      }
      src.connect(this.gains[name]);
      src.start(startAt, offset);
      this.sources.push(src);
    }
    this.startCtxTime = startAt;
    this.startOffset = offset;
    this.playing = true;
  }

  pause() {
    this.playGeneration++;
    if (!this.playing) return;
    this.pausedAt = this.position;
    this.stopSources();
    this.playing = false;
  }

  async seek(t: number) {
    const clamped = Math.max(0, Math.min(t, this.duration));
    if (this.playing) await this.play(clamped);
    else this.pausedAt = clamped;
  }

  /** 구간 반복 (예: 현재 8 count). null이면 해제 */
  async setLoop(range: LoopRange) {
    if (range && (range.start < 0 || range.end > this.duration || range.start >= range.end)) {
      throw new Error('반복 구간이 올바르지 않습니다.');
    }
    const pos = this.position;
    this.loop = range;
    if (this.playing) {
      const inside = range && pos >= range.start && pos < range.end;
      await this.play(range && !inside ? range.start : pos);
    } else if (range && (pos < range.start || pos >= range.end)) {
      this.pausedAt = range.start;
    }
  }

  /** 레이어 볼륨. 클릭 노이즈 없이 20ms 동안 부드럽게 변경 */
  setGain(name: string, value: number) {
    const g = this.gains[name];
    if (!g) return;
    g.gain.cancelScheduledValues(this.ctx.currentTime);
    g.gain.setTargetAtTime(Math.max(0, Math.min(value, 1.5)), this.ctx.currentTime, 0.02);
  }

  setMaster(value: number) {
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(Math.max(0, Math.min(value, 1)), this.ctx.currentTime, 0.02);
  }

  private stopSources() {
    for (const s of this.sources) {
      try {
        s.stop();
        s.disconnect();
      } catch {
        /* already stopped */
      }
    }
    this.sources = [];
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.playGeneration++;
    this.stopSources();
    this.playing = false;
    this.buffers = {};
    this.gains = {};
    this.waveforms = {};
    this.envelopes = {};
    this.pulsePatterns = {};
    await this.ctx.close();
  }
}
