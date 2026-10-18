import Slider from '@react-native-community/slider';
import { useKeepAwake } from 'expo-keep-awake';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Analysis, api, Job, lastIndexAtOrBefore } from '../api';
import { initialMix, layerGain, Mix } from '../audio/mix';
import { LoopRange, StemPlayer } from '../audio/StemPlayer';
import StemRow from '../components/StemRow';
import Timeline from '../components/Timeline';
import WatchHapticsCard from '../components/WatchHapticsCard';
import { C, fmtTime, STEM_LABELS } from '../theme';
import { PlaybackSnapshot } from '../state/model';
import CameraTab from '../components/tracking/CameraTab';
import { DEFAULT_CONFIG } from '../tracking/config';
import { LiveTrackingStore } from '../tracking/store';
import { planFor } from '../tracking/windows';

const TABS = [['mixer', '믹서'], ['camera', '카메라']] as const;
const perfNowMs = () => performance.now();

type Props = { server: string; job: Job; onBack: () => void; initialSnapshot?: PlaybackSnapshot; onSnapshot?: (value: PlaybackSnapshot) => void; onFinish?: (value: PlaybackSnapshot) => void };
export default function PlayerScreen({ server, job, onBack, initialSnapshot, onSnapshot, onFinish }: Props) {
  useKeepAwake();
  const [initial] = useState(initialSnapshot);
  const listened = useRef(initial?.listened ?? 0);
  const layerSeconds = useRef<Record<string, number>>({ ...initial?.layerSeconds });
  const latest = useRef<PlaybackSnapshot>({ position: initial?.position ?? 0, duration: initial?.duration ?? 0, mix: initial?.mix ?? {}, master: initial?.master ?? .8, loop: initial?.loop ?? null, listened: initial?.listened ?? 0, layerSeconds: { ...initial?.layerSeconds } });
  const player = useRef<StemPlayer | null>(null);
  const [loadedPlayer, setLoadedPlayer] = useState<StemPlayer | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState('레이어를 불러오는 중');
  const [error, setError] = useState<string | null>(null);
  const [pos, setPos] = useState(0), [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false), [mix, setMix] = useState<Mix>({});
  const [master, setMaster] = useState(0.8), [loopRange, setLoopRange] = useState<LoopRange>(null);
  const [showAnalysis, setShowAnalysis] = useState(false), [reloading, setReloading] = useState(0);
  const [scrubbing, setScrubbing] = useState(false), [analysisNotice, setAnalysisNotice] = useState('');
  const [transportBusy, setTransportBusy] = useState(false);
  const [tab, setTab] = useState<'mixer' | 'camera'>('mixer');
  // One tracking session per practice session; it outlives tab switches.
  const [tracking] = useState(() => {
    const store = new LiveTrackingStore(DEFAULT_CONFIG, { perfNowMs });
    store.importTracking(initial?.tracking); // resumed session: keep counting from its saved totals
    return store;
  });
  const [waveforms, setWaveforms] = useState<Record<string, number[]>>({});
  const [levels, setLevels] = useState<Record<string, number>>({});
  useEffect(() => {
    let alive = true;
    let p: StemPlayer | null = null;
    (async () => {
      try {
        p = new StemPlayer(); player.current = p;
        p.onEnded = () => { if (alive) { setPlaying(false); setPos(0); } };
        const files = Object.fromEntries(Object.entries(job.files ?? {}).filter(([key]) => key !== 'mix'));
        await p.load(files, (done, total) => { if (alive) setLoading(`레이어 불러오는 중 ${done} / ${total}`); });
        if (!alive) return;
        const restoredMix = initialMix(p.stems);
        for (const stem of p.stems) if (initial?.mix[stem]) restoredMix[stem] = initial.mix[stem];
        const restoredMaster = initial?.master ?? .8;
        p.setMaster(restoredMaster); setMaster(restoredMaster);
        for (const stem of p.stems) p.setGain(stem, layerGain(restoredMix, stem));
        if (initial?.loop && initial.loop.end <= p.duration) { await p.setLoop(initial.loop); setLoopRange(initial.loop); }
        if (initial?.position) await p.seek(Math.min(initial.position, Math.max(0, p.duration - .05)));
        setPos(p.position); setLoadedPlayer(p); setDuration(p.duration); setMix(restoredMix); setLoading('');
        setWaveforms(Object.fromEntries(p.stems.map(stem => [stem, p!.waveform(stem)])));
        // Beat analysis is optional; failures must not block audio mixing.
        if (job.analysisUrl) {
          try {
            const result = await api.analysis(server, job.id);
            if (alive && Array.isArray(result.beats) && Array.isArray(result.eights) && Array.isArray(result.sections)) setAnalysis(result);
            else if (alive) setAnalysisNotice('박자 정보가 없어도 레이어 믹서를 사용할 수 있어요.');
          } catch { if (alive) setAnalysisNotice('박자 정보를 가져오지 못했어요. 믹서는 계속 사용할 수 있어요.'); }
        }
      } catch (e) { if (alive) setError(String(e)); }
    })();
    return () => { alive = false; player.current = null; void p?.dispose().catch(() => {}); };
  }, [server, job, reloading, initial]);
  useEffect(() => {
    tracking.setMusicSource(loadedPlayer ? () => ({ position: loadedPlayer.position, playing: loadedPlayer.playing }) : null);
    return () => tracking.setMusicSource(null);
  }, [tracking, loadedPlayer]);
  useEffect(() => {
    tracking.setPlan(planFor(analysis?.eights, analysis?.tempo ?? job.tempo, DEFAULT_CONFIG.aggregate.windows['8count_s']));
  }, [tracking, analysis, job.tempo]);
  useEffect(() => {
    if (!playing || scrubbing) return;
    const interval = setInterval(() => {
      const p = player.current;
      if (!p) return;
      const time = p.position;
      setPos(time);
      setLevels(Object.fromEntries(p.stems.map(stem => [stem, p.levelAt(stem, time)])));
    }, 100);
    return () => clearInterval(interval);
  }, [playing, scrubbing]);
  useEffect(() => { for (const stem of Object.keys(mix)) player.current?.setGain(stem, layerGain(mix, stem)); }, [mix]);
  useEffect(() => { player.current?.setMaster(master); }, [master]);
  useEffect(() => {
    latest.current = { position: pos, duration, mix, master, loop: loopRange, listened: listened.current, layerSeconds: layerSeconds.current };
  }, [pos, duration, mix, master, loopRange]);
  useEffect(() => {
    if (!playing) return;
    let last = Date.now();
    const timer = setInterval(() => {
      const now = Date.now(), seconds = Math.min(1.5, (now - last) / 1000); last = now;
      if (!player.current?.playing || AppState.currentState === 'background') return;
      listened.current += seconds;
      const snap = latest.current;
      if (snap.master > 0) for (const stem of Object.keys(snap.mix)) if (layerGain(snap.mix, stem) > 0) layerSeconds.current[stem] = (layerSeconds.current[stem] ?? 0) + seconds;
      latest.current = { ...snap, listened: listened.current, layerSeconds: { ...layerSeconds.current } };
    }, 500);
    return () => clearInterval(timer);
  }, [playing]);
  useEffect(() => {
    const timer = setInterval(() => { if (latest.current.duration > 0) onSnapshot?.(withTracking(tracking, latest.current)); }, 5000);
    return () => { clearInterval(timer); if (latest.current.duration > 0) onSnapshot?.(withTracking(tracking, latest.current)); };
  }, [onSnapshot, tracking]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') {
        player.current?.pause(); setPlaying(false); if (player.current) setPos(player.current.position);
        if (latest.current.duration > 0) onSnapshot?.(withTracking(tracking, latest.current));
      }
    });
    return () => subscription.remove();
  }, [onSnapshot, tracking]);
  const patch = (stem: string, changes: Partial<Mix[string]>) => setMix(value => ({ ...value, [stem]: { ...value[stem], ...changes } }));
  const perform = async (action: (p: StemPlayer) => Promise<void> | void) => {
    const p = player.current;
    if (!p || transportBusy) return;
    setTransportBusy(true);
    try { await action(p); setPlaying(p.playing); setPos(p.position); }
    catch (e) { setError(String(e)); }
    finally { setTransportBusy(false); }
  };
  const seek = (time: number) => perform(p => p.seek(time));
  // [춤 시작] plays only when stopped: StemPlayer.play() while playing would jump back to the paused position.
  const startPlayback = () => { if (!player.current?.playing) void perform(p => p.play()); };
  const reset = () => { setMix(initialMix(Object.keys(mix))); setMaster(0.8); };
  const retry = () => { setLoadedPlayer(null); setError(null); setLoading('레이어를 다시 불러오는 중'); setPlaying(false); setPos(0); setLoopRange(null); setAnalysis(null); setAnalysisNotice(''); setMaster(0.8); setReloading(value => value + 1); };
  const beatIndex = analysis ? lastIndexAtOrBefore(analysis.beats, pos + 0.03, b => b.t) : -1;
  const eightIndex = analysis ? lastIndexAtOrBefore(analysis.eights, pos, e => e.start) : -1;
  const beat = analysis?.beats[beatIndex], eight = analysis?.eights[eightIndex];
  const name = job.name.replace(/\.[^.]+$/, '');
  if (error || loading) return (
    <View style={s.center}>
      <Text style={s.eyebrow}>CHOREOLAYER / SESSION</Text>
      {error ? <><Text style={s.errorTitle}>레이어를 열 수 없어요</Text><Text style={s.error}>{error}</Text><Pressable accessibilityRole="button" onPress={retry} style={s.primary}><Text style={s.primaryText}>다시 시도</Text></Pressable></>
        : <><ActivityIndicator color={C.accent} size="large" /><Text style={s.loadText}>{loading}</Text><Text style={s.small}>각 레이어를 준비한 뒤 함께 재생합니다.</Text></>}
      <Pressable accessibilityRole="button" onPress={onBack} style={s.backButton}><Text style={s.sub}>‹ 홈으로 돌아가기</Text></Pressable>
    </View>
  );
  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.top}><Pressable accessibilityRole="button" onPress={onBack} hitSlop={12}><Text style={s.back}>‹ 저장하고 나가기</Text></Pressable><Text style={s.eyebrow}>MY SESSION</Text></View>
        <View style={s.tabs}>{TABS.map(([key, title]) => <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: tab === key }} onPress={() => setTab(key)} style={[s.tab, tab === key && s.tabOn]}><Text style={[s.tabText, tab === key && s.tabTextOn]}>{title}</Text></Pressable>)}</View>
        {tab === 'camera' && <CameraTab store={tracking} playing={playing} onPlay={startPlayback} />}
        {/* The mixer stays mounted (watch haptics keep running) and is only hidden on the camera tab. */}
        <View style={tab === 'mixer' ? undefined : s.hidden}>
        <View style={s.hero}>
          <View style={s.tag}><View style={s.statusDot} /><Text style={s.tagText}>{Object.keys(mix).length} LAYERS READY</Text></View>
          <Text style={s.title} numberOfLines={2}>{name}</Text>
          <Text style={s.sub}>{job.config.provider === 'lalal' ? 'LALAL.AI' : job.config.model === 'demo' ? '체험 음악' : job.config.model === 'imported' ? '내가 가져온 레이어' : 'Demucs'} · {fmtTime(duration)}{analysis?.tempo ? ` · ${Math.round(analysis.tempo)} BPM` : ''}</Text>
        </View>
        <View style={s.sectionHead}><View><Text style={s.section}>나만의 밸런스</Text><Text style={s.small}>슬라이더로 각 소리의 크기를 조절하세요.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="믹스 초기화" onPress={reset} style={s.reset}><Text style={s.resetText}>초기화 ↺</Text></Pressable></View>
        {Object.keys(mix).map((stem, index) => <StemRow key={stem} stem={stem} index={index} volume={mix[stem].volume} muted={mix[stem].muted} solo={mix[stem].solo} audible={layerGain(mix, stem) > 0} level={playing ? levels[stem] ?? 0 : 0} waveform={waveforms[stem] ?? []} progress={duration ? pos / duration : 0} onVolume={value => patch(stem, { volume: value })} onMute={() => patch(stem, { muted: !mix[stem].muted })} onSolo={() => patch(stem, { solo: !mix[stem].solo })} />)}
        <View style={s.master}><View style={s.masterHead}><Text style={s.masterLabel}>전체 볼륨</Text><Text style={s.masterValue}>{Math.round(master * 100)}%</Text></View><Slider accessibilityLabel="전체 볼륨" style={s.masterSlider} minimumValue={0} maximumValue={1} step={0.01} value={master} onValueChange={setMaster} minimumTrackTintColor={C.text} maximumTrackTintColor={C.line} thumbTintColor={C.text} /></View>
        {loadedPlayer && <WatchHapticsCard player={loadedPlayer} playing={playing} loopKey={JSON.stringify(loopRange)} transportBusy={transportBusy} />}
        {analysis && <>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: showAnalysis }} style={s.analysisToggle} onPress={() => setShowAnalysis(value => !value)}><Text style={s.sub}>박자 · 구간 보기</Text><Text style={s.sub}>{showAnalysis ? '−' : '+'}</Text></Pressable>
          {showAnalysis && <View style={s.analysisCard}>
            <View style={s.countRow}><Text style={s.count}>{beat?.count ?? '–'}<Text style={s.countOf}> / 8</Text></Text><Text style={s.sub}>{eight ? `${eight.index + 1}번째 8 count` : '도입'}</Text><Pressable accessibilityRole="button" disabled={!eight} style={s.reset} onPress={() => perform(async p => { const range = eight ? { start: eight.start, end: Math.min(eight.end, duration) } : null; await p.setLoop(range); setLoopRange(range); })}><Text style={s.resetText}>이 구간 반복</Text></Pressable></View>
            <Timeline a={analysis} pos={pos} loop={loopRange} onSeek={seek} />
            {analysis.sections.map((section, i) => <Pressable accessibilityRole="button" key={i} style={s.sectionRow} onPress={() => seek(section.start)}><Text style={s.sectionLabel}>{section.label}</Text><Text style={s.sub}>{fmtTime(section.start)} – {fmtTime(section.end)}</Text><Text style={s.sectionStems} numberOfLines={1}>{section.activeStems.map(stem => STEM_LABELS[stem] ?? stem).join(' · ')}</Text></Pressable>)}
          </View>}
        </>}
        {!!analysisNotice && <Text style={s.small}>{analysisNotice}</Text>}
        </View>
        {onFinish && <Pressable accessibilityRole="button" onPress={() => { void perform(async p => { await p.pause(); onFinish(withTracking(tracking, { ...latest.current, position: p.position, listened: listened.current, layerSeconds: { ...layerSeconds.current } })); }); }} style={[s.primary, { marginTop: 24, alignItems: 'center' }]}><Text style={s.primaryText}>세션 마치고 기록 저장</Text></Pressable>}
        <Text style={s.footerNote}>소리를 덜어내면, 새로운 음악이 들립니다.</Text>
      </ScrollView>
      <View style={s.dock}>
        <View style={s.timeRow}><Text style={s.time}>{fmtTime(pos)}</Text><Text style={s.time}>{fmtTime(duration)}</Text></View>
        <Slider accessibilityLabel="재생 위치" style={s.seekSlider} minimumValue={0} maximumValue={duration || 1} value={pos} minimumTrackTintColor={C.accent} maximumTrackTintColor={C.line} thumbTintColor={C.accent} onSlidingStart={() => setScrubbing(true)} onValueChange={setPos} onSlidingComplete={time => { setScrubbing(false); void seek(time); }} />
        <View style={s.transport}>
          <Pressable accessibilityRole="button" accessibilityLabel="곡 반복" accessibilityState={{ selected: !!loopRange }} disabled={transportBusy} onPress={() => perform(async p => { const range = loopRange ? null : { start: 0, end: duration }; await p.setLoop(range); setLoopRange(range); })} style={[s.sideButton, loopRange && s.repeatOn]}><Text style={[s.sideText, loopRange && { color: C.accent }]}>↻</Text><Text style={s.transportHint}>{loopRange ? '반복 중' : '반복'}</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="10초 뒤로" disabled={transportBusy} onPress={() => seek(pos - 10)} style={s.sideButton}><Text style={s.skip}>−10</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={playing ? '일시정지' : '재생'} disabled={transportBusy} style={[s.play, transportBusy && { opacity: 0.6 }]} onPress={() => perform(p => p.playing ? p.pause() : p.play())}><Text style={s.playIcon}>{playing ? 'Ⅱ' : '▶'}</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="10초 앞으로" disabled={transportBusy} onPress={() => seek(pos + 10)} style={s.sideButton}><Text style={s.skip}>+10</Text></Pressable>
          <View style={s.sideButton}><View style={[s.liveDot, playing && { backgroundColor: C.accent }]} /><Text style={s.transportHint}>{playing ? '재생 중' : '준비됨'}</Text></View>
        </View>
      </View>
    </View>
  );
}
/** The playback snapshot plus the camera tab's totals, once anything was tracked (or restored). */
function withTracking(store: LiveTrackingStore, snap: PlaybackSnapshot): PlaybackSnapshot {
  const tracking = store.exportTracking();
  return tracking ? { ...snap, tracking } : snap;
}

const s = StyleSheet.create({
  tabs: { flexDirection: 'row', backgroundColor: C.card, borderRadius: 14, padding: 4, marginBottom: 22 },
  tab: { flex: 1, minHeight: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: C.cardHi },
  tabText: { color: C.sub, fontSize: 13, fontWeight: '600' },
  tabTextOn: { color: C.accent },
  hidden: { display: 'none' },
  root: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center' }, content: { paddingHorizontal: 22, paddingBottom: 24 }, top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 14, paddingBottom: 28 }, back: { color: C.sub, fontSize: 13 }, eyebrow: { color: C.dim, fontSize: 10, fontWeight: '700', letterSpacing: 2.4 },
  hero: { marginBottom: 28 }, tag: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 12 }, statusDot: { width: 5, height: 5, backgroundColor: C.accent, borderRadius: 3 }, tagText: { color: C.accent, fontSize: 9, fontWeight: '700', letterSpacing: 1.8 }, title: { color: C.text, fontSize: 32, lineHeight: 40, fontWeight: '700', letterSpacing: -1.1, marginBottom: 8 }, sub: { color: C.sub, fontSize: 12 }, small: { color: C.dim, fontSize: 11, lineHeight: 18, marginTop: 5 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 8 }, section: { color: C.text, fontSize: 18, fontWeight: '600' }, reset: { paddingHorizontal: 10, paddingVertical: 10, borderRadius: 8, backgroundColor: C.cardHi }, resetText: { color: C.sub, fontSize: 11 },
  master: { paddingHorizontal: 16, paddingTop: 6, marginTop: 10 }, masterHead: { flexDirection: 'row', justifyContent: 'space-between' }, masterLabel: { color: C.sub, fontSize: 12 }, masterValue: { color: C.text, fontSize: 12, fontVariant: ['tabular-nums'] }, masterSlider: { height: 36 },
  dock: { borderTopWidth: 1, borderColor: C.line, backgroundColor: C.bg, paddingHorizontal: 24, paddingTop: 10, paddingBottom: 14 }, timeRow: { flexDirection: 'row', justifyContent: 'space-between' }, time: { color: C.sub, fontSize: 10, fontVariant: ['tabular-nums'] }, seekSlider: { height: 26 }, transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', paddingTop: 6 }, play: { width: 60, height: 60, borderRadius: 30, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' }, playIcon: { color: C.bg, fontSize: 24, fontWeight: '800' }, sideButton: { width: 46, minHeight: 44, alignItems: 'center', justifyContent: 'center', gap: 3 }, sideText: { color: C.sub, fontSize: 24 }, skip: { color: C.text, fontSize: 14, fontWeight: '600' }, transportHint: { color: C.dim, fontSize: 8 }, liveDot: { width: 6, height: 6, backgroundColor: C.dim, borderRadius: 3 }, repeatOn: { backgroundColor: C.card, borderRadius: 12 },
  analysisToggle: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 20, borderTopWidth: 1, borderColor: C.line, marginTop: 16 }, analysisCard: { gap: 12, paddingBottom: 12 }, countRow: { flexDirection: 'row', alignItems: 'center', gap: 12 }, count: { color: C.text, fontSize: 28, fontWeight: '600' }, countOf: { color: C.dim, fontSize: 14 }, sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }, sectionLabel: { color: C.accent, fontWeight: '700' }, sectionStems: { color: C.dim, fontSize: 10, flex: 1, textAlign: 'right' }, footerNote: { color: C.dim, fontSize: 10, textAlign: 'center', marginTop: 28 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 16 }, errorTitle: { color: C.text, fontSize: 24, fontWeight: '700' }, error: { color: C.err, lineHeight: 22, textAlign: 'center' }, primary: { backgroundColor: C.accent, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 14 }, primaryText: { color: C.bg, fontWeight: '700' }, backButton: { padding: 14 }, loadText: { color: C.text, fontSize: 16 },
});
