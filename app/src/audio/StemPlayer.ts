import { detectPulses, Pulse } from '../haptics/pattern';
import { AudioBuffer, AudioBufferSourceNode, AudioContext, AudioManager, GainNode } from 'react-native-audio-api';
import { layerAnalysisIdentity, readLayerAnalysis, writeLayerAnalysis, type LayerAnalysis } from './layerAnalysisCache';

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
type FileSource = NonNullable<ReturnType<AudioContext['context']['createFileSource']>>;
// Keep compact derived data only; decoded audio remains owned by each player.
const analysisCache = new Map<string, LayerAnalysis>();
const CACHE_LIMIT = 24;

export class StemPlayer {
  private ctx: AudioContext;
  private master: GainNode;
  private buffers: Record<string, AudioBuffer> = {};
  private gains: Record<string, GainNode> = {};
  private sources: AudioBufferSourceNode[] = [];
  private fileSources: Record<string, FileSource> = {};
  private fileOutputs: { disconnect: () => void }[] = [];
  private fileMode = false;
  private filePreparing = false;
  private startCtxTime = 0;
  private startOffset = 0;
  private pausedAt = 0;
  private speed = 1;
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
    return Object.keys(this.fileMode ? this.fileSources : this.buffers);
  }
  get playbackRate() { return this.speed; }

  async setPlaybackRate(rate: number) {
    if (!Number.isFinite(rate) || rate < 0.5 || rate > 1.5) throw new Error('Playback speed must be between 0.5× and 1.5×.');
    if (rate === this.speed) return;
    const position = this.playing ? this.position : this.pausedAt;
    this.speed = rate;
    for (const source of Object.values(this.fileSources)) source.playbackRate = rate;
    // A pending grouped seek will start all files with the new rate. Otherwise
    // restart the whole group at one position instead of changing active nodes serially.
    if (this.playing && !this.filePreparing) await this.play(position);
  }

  /** stem 파일들을 받아 디코드. onProgress(완료 수, 전체 수) */
  async load(files: Record<string, string>, onProgress?: (done: number, total: number) => void) {
    const entries = Object.entries(files);
    if (!entries.length) throw new Error("No layer files available to play.");
    if (this.disposed) throw new Error("The player has closed.");
    const native = this.ctx.context;
    if (entries.length >= 5 && entries.every(([, uri]) => uri.startsWith('file://')) && typeof native?.createFileSource === 'function') {
      const sources: Record<string, FileSource> = {};
      try {
        for (const [name, uri] of entries) {
          const raw = native.createFileSource({ source: uri.replace(/^file:\/\//, ''), loop: false, volume: 1, playbackRate: this.speed, preservesPitch: true });
          if (!raw || !Number.isFinite(raw.duration) || raw.duration <= 0) throw new Error(`Could not open ${name}.`);
          sources[name] = raw;
          const gain = this.ctx.createGain(); gain.connect(this.master); this.gains[name] = gain;
          const audioContext = native as typeof native & { createMediaElementSource: (source: FileSource) => { connect: (destination: Parameters<FileSource['connect']>[0]) => void; disconnect: () => void } };
          const output = audioContext.createMediaElementSource(raw);
          output.connect((gain as unknown as { node: Parameters<FileSource['connect']>[0] }).node);
          this.fileOutputs.push(output);
          onProgress?.(Object.keys(sources).length, entries.length);
          await new Promise<void>(resolve => setTimeout(resolve, 0));
          if (this.disposed) throw new Error('The player has closed.');
        }
        const durations = Object.values(sources).map(source => source.duration);
        if (Math.max(...durations) - Math.min(...durations) > .15) throw new Error('Layer lengths differ. Select files separated from the same track.');
        this.fileSources = sources; this.fileMode = true; this.duration = Math.min(...durations);
        // Analyze only the tracks needed for haptics, one at a time; streaming sources stay on disk.
        for (const name of ['bass', 'drums']) {
          if (!files[name]) continue;
          const key = layerAnalysisIdentity(files[name], name);
          const existing = analysisCache.get(key) ?? readLayerAnalysis(files[name], name);
          if (existing) {
            analysisCache.set(key, existing);
            this.pulsePatterns[name === 'bass' ? 'bass' : 'kick'] = existing.pulses ?? [];
            this.waveforms[name] = existing.waveform; this.envelopes[name] = existing.envelope;
            continue;
          }
          let decoded: AudioBuffer;
          try { decoded = await this.ctx.decodeAudioData(files[name]); }
          catch { continue; } // The mixer remains usable if optional haptic analysis fails.
          if (this.disposed) throw new Error('The player has closed.');
          let cached = analysisCache.get(key);
          if (!cached) {
            const channel = decoded.getChannelData(0);
            const envelope = Array.from({ length: Math.ceil(decoded.duration * 10) }, (_, i) => {
              let peak = 0; const end = Math.min(channel.length, Math.floor((i + 1) * decoded.sampleRate / 10));
              for (let n = Math.floor(i * decoded.sampleRate / 10); n < end; n += 32) peak = Math.max(peak, Math.abs(channel[n]));
              return Math.min(1, peak);
            });
            const waveform = Array.from({ length: 64 }, (_, i) => {
              const start = Math.floor(i * channel.length / 64), end = Math.floor((i + 1) * channel.length / 64), stride = Math.max(1, Math.floor((end - start) / 128));
              let peak = 0; for (let n = start; n < end; n += stride) peak = Math.max(peak, Math.abs(channel[n])); return peak;
            });
            cached = { waveform, envelope, pulses: detectPulses(channel, decoded.sampleRate, name === 'bass' ? 'bass' : 'kick') };
            analysisCache.set(key, cached);
            writeLayerAnalysis(files[name], name, cached);
            if (analysisCache.size > CACHE_LIMIT) analysisCache.delete(analysisCache.keys().next().value!);
          }
          this.pulsePatterns[name === 'bass' ? 'bass' : 'kick'] = cached.pulses ?? [];
          this.waveforms[name] = cached.waveform; this.envelopes[name] = cached.envelope;
        }
        return;
      } catch (error) {
        for (const output of this.fileOutputs) { try { output.disconnect(); } catch {} }
        this.fileOutputs = [];
        for (const source of Object.values(sources)) { try { source.disconnect(); } catch {} }
        throw error;
      }
    }
    let done = 0;
    const buffers: Record<string, AudioBuffer> = {};
    // Decode sequentially to avoid holding several compressed files in memory at once.
    for (const [name, url] of entries) {
        const buf = await this.ctx.decodeAudioData(url);
        if (this.disposed) return;
        if (!Number.isFinite(buf.duration) || buf.duration <= 0) throw new Error(`${name}: audio file is empty.`);
        buffers[name] = buf;
        onProgress?.(++done, entries.length);
    }
    const durations = Object.values(buffers).map(b => b.duration);
    if (Math.max(...durations) - Math.min(...durations) > 0.15) {
      throw new Error("Layer lengths differ. Select files separated from the same track.");
    }
    this.buffers = buffers;
    for (const [name, buf] of Object.entries(buffers)) {
        const g = this.ctx.createGain();
        g.connect(this.master);
        this.gains[name] = g;
        const key = `${layerAnalysisIdentity(files[name], name)}:${buf.duration}:${buf.sampleRate}`;
        const cached = analysisCache.get(key) ?? readLayerAnalysis(files[name], name);
        if (cached) {
          analysisCache.delete(key); analysisCache.set(key, cached);
          this.envelopes[name] = cached.envelope; this.waveforms[name] = cached.waveform;
          if (cached.pulses) this.pulsePatterns[name === 'bass' ? 'bass' : 'kick'] = cached.pulses;
          continue;
        }
        const channel = buf.getChannelData(0);
        const pulses = name === 'bass' || name === 'drums' ? detectPulses(channel, buf.sampleRate, name === 'bass' ? 'bass' : 'kick') : undefined;
        if (pulses) this.pulsePatterns[name === 'bass' ? 'bass' : 'kick'] = pulses;
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
        analysisCache.set(key, { waveform: this.waveforms[name], envelope: this.envelopes[name], pulses });
        writeLayerAnalysis(files[name], name, { waveform: this.waveforms[name], envelope: this.envelopes[name], pulses });
        if (analysisCache.size > CACHE_LIMIT) analysisCache.delete(analysisCache.keys().next().value!);
    }
    this.duration = Math.min(...durations);
  }

  private pulsePatterns: Record<string, Pulse[]> = {};
  pulses(kind: 'bass' | 'kick'): Pulse[] { return this.pulsePatterns[kind] ?? []; }
  get transport() {
    const position = this.position;
    return { positionMs: position * 1000, playing: this.playing && !this.filePreparing, loop: this.loop ? { startMs: this.loop.start * 1000, endMs: this.loop.end * 1000 } : null,
      startDelayMs: this.playing && !this.filePreparing ? Math.max(0, this.startCtxTime - this.ctx.currentTime) * 1000 : 0 };
  }

  waveform(name: string): number[] { return this.waveforms[name] ?? []; }

  levelAt(name: string, time: number): number {
    if (!this.playing) return 0;
    return this.envelopes[name]?.[Math.floor(time * 10)] ?? 0;
  }

  /** 현재 재생 위치(초) */
  get position(): number {
    if (!this.playing) return this.pausedAt;
    if (this.filePreparing) return this.startOffset;
    let p = this.startOffset + Math.max(0, this.ctx.currentTime - this.startCtxTime) * this.speed;
    if (this.loop && p >= this.loop.end) {
      const len = this.loop.end - this.loop.start;
      p = this.loop.start + ((p - this.loop.start) % len);
      if (this.fileMode) {
        // All decoders must seek as one group; otherwise a slower decoder falls behind.
        this.startOffset = p;
        void this.play(p);
        return p;
      }
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
    if (this.fileMode) {
      let offset = Math.max(0, Math.min(from ?? this.pausedAt, Math.max(0, this.duration - .01)));
      if (this.loop && (offset < this.loop.start || offset >= this.loop.end)) offset = this.loop.start;
      const sources = Object.values(this.fileSources);
      this.filePreparing = true; this.startOffset = offset;
      // Pausing before seeking prevents the old playback from running while decoder threads catch up.
      for (const source of sources) source.pause();
      for (const source of sources) source.seekToTime(offset);
      await new Promise<void>(resolve => setTimeout(resolve, 300));
      if (this.disposed || generation !== this.playGeneration) return;
      const startAt = this.ctx.currentTime + .08;
      for (const source of sources) source.start(startAt);
      this.filePreparing = false;
      this.startCtxTime = startAt; this.startOffset = offset; this.playing = true;
      return;
    }
    this.stopSources();
    let offset = Math.max(0, Math.min(from ?? this.pausedAt, Math.max(0, this.duration - 0.01)));
    if (this.loop && (offset < this.loop.start || offset >= this.loop.end)) offset = this.loop.start;
    const prepared: AudioBufferSourceNode[] = [];
    for (const [name, buf] of Object.entries(this.buffers)) {
      const src = this.ctx.createBufferSource({ pitchCorrection: true });
      src.buffer = buf;
      src.playbackRate.value = this.speed;
      if (this.loop) {
        src.loop = true;
        src.loopStart = this.loop.start;
        src.loopEnd = this.loop.end;
      }
      src.connect(this.gains[name]);
      prepared.push(src);
      // Let the JS runtime process pending work between expensive buffer assignments.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      if (this.disposed || generation !== this.playGeneration) {
        for (const pending of prepared) { try { pending.disconnect(); } catch {} }
        return;
      }
    }
    const startAt = this.ctx.currentTime + .08;
    this.sources = prepared;
    for (const src of prepared) {
      src.playbackRate.value = this.speed;
      src.start(startAt - (typeof src.getLatency === 'function' ? src.getLatency() : 0), offset);
    }
    this.startCtxTime = startAt;
    this.startOffset = offset;
    this.playing = true;
  }

  pause() {
    this.playGeneration++;
    if (!this.playing && !this.filePreparing) return;
    this.pausedAt = this.filePreparing ? this.startOffset : this.position;
    this.filePreparing = false;
    if (this.fileMode) for (const source of Object.values(this.fileSources)) source.pause();
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
      throw new Error("Invalid loop range.");
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
      try { s.stop(); } catch { /* not started or already stopped */ }
      try { s.disconnect(); } catch { /* already disconnected */ }
    }
    this.sources = [];
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.playGeneration++;
    this.stopSources();
    for (const output of this.fileOutputs) { try { output.disconnect(); } catch {} }
    this.fileOutputs = [];
    for (const source of Object.values(this.fileSources)) { try { source.stop(0); } catch {} try { source.disconnect(); } catch {} }
    this.fileSources = {}; this.fileMode = false;
    this.filePreparing = false;
    this.playing = false;
    this.buffers = {};
    this.gains = {};
    this.waveforms = {};
    this.envelopes = {};
    this.pulsePatterns = {};
    await this.ctx.close();
  }
}
