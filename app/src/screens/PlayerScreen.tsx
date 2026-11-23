import { Text } from '../ui/Typography';
import { createCreativePrompt, MOVEMENT_AXES, type MovementAxis, type CreativePrompt } from '../agent/prompts';
import { Icon } from '../ui/Kit';
import { displayMessage } from '../ui/displayMessage';
import VideoPreview from '../ui/VideoPreview';
import Slider from '@react-native-community/slider';
import { useKeepAwake } from 'expo-keep-awake';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Analysis, api, Job, lastIndexAtOrBefore } from '../api';
import { crossedLoop } from '../audio/composition';
import { initialMix, layerGain, Mix } from '../audio/mix';
import { LoopRange, StemPlayer } from '../audio/StemPlayer';
import StemRow from '../components/StemRow';
import Timeline from '../components/Timeline';
import WatchHapticsCard from '../components/WatchHapticsCard';
import WatchMixerCard from '../components/WatchMixerCard';
import { applyWatchMasterCommands, applyWatchMixerCommands } from '../audio/watchMixer';
import { useDevice } from '../state/DeviceProvider';
import { C, fmtTime, STEM_LABELS } from '../theme';
import type { Motif } from '../state/extras';
import { discardTemporaryVideo } from '../storage/media';
import { PlaybackSnapshot } from '../state/model';
import CameraTab from '../components/tracking/CameraTab';
import CameraMixer from '../components/CameraMixer';
import type { DisplayProposal } from '../components/tracking/ProjectionCard';
import { DEFAULT_CONFIG } from '../tracking/config';
import { LiveTrackingStore } from '../tracking/store';
import { planFor } from '../tracking/windows';

const TABS = [['mixer', "Mixer"], ['camera', "Camera"]] as const;
const perfNowMs = () => performance.now();

type Props = { server: string; job: Job; onBack: () => void; initialSnapshot?: PlaybackSnapshot; missionTitle?: string; onSnapshot?: (value: PlaybackSnapshot) => void; onFinish?: (value: PlaybackSnapshot) => void; onSaveVideo?: (uri: string, start: number, end: number, mix: Mix, videoOffset: number, videoRate: number) => Promise<void>; onSaveMotif?: (value: Pick<Motif, 'start' | 'end' | 'eightIndex' | 'body' | 'level' | 'mix'>) => void };
export default function PlayerScreen({ server, job, onBack, initialSnapshot, missionTitle, onSnapshot, onFinish, onSaveMotif, onSaveVideo }: Props) {
  const { ensureWatch } = useDevice();
  useEffect(() => { void ensureWatch(); }, [ensureWatch]);
  useKeepAwake();
  const { width, fontScale } = useWindowDimensions();
  const twoColumns = width >= 340 && fontScale <= 1.2;
  const [initial] = useState(initialSnapshot);
  const listened = useRef(initial?.listened ?? 0);
  const layerSeconds = useRef<Record<string, number>>({ ...initial?.layerSeconds });
  const latest = useRef<PlaybackSnapshot>({ position: initial?.position ?? 0, duration: initial?.duration ?? 0, mix: initial?.mix ?? {}, master: initial?.master ?? .8, loop: initial?.loop ?? null, listened: initial?.listened ?? 0, layerSeconds: { ...initial?.layerSeconds } });
  const player = useRef<StemPlayer | null>(null);
  const [loadedPlayer, setLoadedPlayer] = useState<StemPlayer | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState("Loading layers");
  const [error, setError] = useState<string | null>(null);
  const [pos, setPos] = useState(0), [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false), [mix, setMix] = useState<Mix>({});
  const [master, setMaster] = useState(0.8), [loopRange, setLoopRange] = useState<LoopRange>(null), [playbackRate, setPlaybackRate] = useState(initial?.playbackRate ?? 1);
  const [savedMotif, setSavedMotif] = useState(false);
  const [showWatch, setShowWatch] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false), [reloading, setReloading] = useState(0);
  const [scrubbing, setScrubbing] = useState(false), [analysisNotice, setAnalysisNotice] = useState('');
  const [transportBusy, setTransportBusy] = useState(false);
  const [saveRevision, setSaveRevision] = useState(0);
  const [recordingVideo, setRecordingVideo] = useState(false), [videoNotice, setVideoNotice] = useState('');
  const [recordCommand, setRecordCommand] = useState(0);
  const [draft, setDraft] = useState<{ uri: string; start: number; end: number; mix: Mix; videoOffset: number; videoRate: number } | null>(null);
  const draftRef = useRef<string | null>(null);
  const [savingVideo, setSavingVideo] = useState(false);
  const videoStart = useRef<number | null>(null), videoLast = useRef(0);
  const videoStartedAt = useRef(0), videoOffset = useRef(0);
  const [tab, setTab] = useState<'mixer' | 'camera'>('mixer');
  // One tracking session per practice session; it outlives tab switches.
  const [tracking] = useState(() => {
    const store = new LiveTrackingStore(DEFAULT_CONFIG, { perfNowMs });
    store.importTracking(initial?.tracking); // resumed session: keep counting from its saved totals
    return store;
  });
  useEffect(() => () => { if (draftRef.current) { try { discardTemporaryVideo(draftRef.current); } catch {} } }, []);
  const [composition, setComposition] = useState(initial?.composition);
  const lastPosition = useRef<number | null>(null), switchingRange = useRef(false);
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
        await p.load(files, (done, total) => { if (alive) setLoading(`Loading layer ${done} / ${total}`); });
        if (!alive) return;
        const restoredMix = initialMix(p.stems);
        for (const stem of p.stems) if (initial?.mix[stem]) restoredMix[stem] = initial.mix[stem];
        const restoredMaster = initial?.master ?? .8;
        await p.setPlaybackRate(initial?.playbackRate ?? 1);
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
            else if (alive) setAnalysisNotice("The layer mixer works without beat data.");
          } catch { if (alive) setAnalysisNotice("Could not load beat data. The mixer is still available."); }
        }
      } catch (e) { if (alive) setError(displayMessage(e)); }
    })();
    return () => { alive = false; player.current = null; void p?.dispose().catch(() => {}); };
  }, [server, job, reloading, initial]);
  useEffect(() => {
    tracking.setMusicSource(loadedPlayer ? () => ({ position: loadedPlayer.position, playing: loadedPlayer.playing, rate: loadedPlayer.playbackRate }) : null);
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
      if (videoStart.current !== null && time >= videoStart.current) videoLast.current = time;
      if (composition && !switchingRange.current && crossedLoop(lastPosition.current, time, loopRange, composition.ranges[composition.index])) {
        const next = (composition.index + 1) % composition.ranges.length, range = composition.ranges[next];
        switchingRange.current = true;
        void p.setLoop(range).then(() => { setLoopRange(range); setComposition({ ...composition, index: next }); lastPosition.current = range.start; }).catch(e => setError(displayMessage(e))).finally(() => { switchingRange.current = false; });
      } else lastPosition.current = time;
      setPos(time);
      setLevels(Object.fromEntries(p.stems.map(stem => [stem, p.levelAt(stem, time)])));
    }, 100);
    return () => clearInterval(interval);
  }, [playing, scrubbing, composition, loopRange]);
  const appliedGains = useRef<{ player: StemPlayer | null; values: Record<string, number> }>({ player: null, values: {} });
  useEffect(() => {
    const p = loadedPlayer;
    if (!p) return;
    if (appliedGains.current.player !== p) appliedGains.current = { player: p, values: {} };
    for (const stem of Object.keys(mix)) {
      const gain = layerGain(mix, stem);
      if (appliedGains.current.values[stem] !== gain) {
        p.setGain(stem, gain);
        appliedGains.current.values[stem] = gain;
      }
    }
  }, [mix, loadedPlayer]);
  useEffect(() => { player.current?.setMaster(master); }, [master]);
  useEffect(() => {
    latest.current = { position: pos, duration, mix, master, loop: loopRange, playbackRate, listened: listened.current, layerSeconds: layerSeconds.current, ...(composition && { composition }) };
  }, [pos, duration, mix, master, loopRange, composition, playbackRate]);
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
    catch (e) { setError(displayMessage(e)); }
    finally { setTransportBusy(false); }
  };
  const seek = (time: number) => { lastPosition.current = null; return perform(p => p.seek(time)); };
  // [춤 시작] plays only when stopped: StemPlayer.play() while playing would jump back to the paused position.
  const playMusic = async (p: StemPlayer) => {
    await p.play();
    if (videoStartedAt.current && videoStart.current === null) {
      videoStart.current = p.position;
      videoLast.current = p.position;
      videoOffset.current = Math.max(0, (Date.now() - videoStartedAt.current) / 1000);
    }
  };
  const startPlayback = () => { if (!player.current?.playing) void perform(playMusic); };
  const reset = () => { setMix(initialMix(Object.keys(mix))); setMaster(0.8); };
  const retry = () => { setLoadedPlayer(null); setError(null); setLoading("Reloading layers"); setPlaying(false); setPos(0); setLoopRange(null); setAnalysis(null); setAnalysisNotice(''); setMaster(0.8); setReloading(value => value + 1); };
  const beatIndex = analysis ? lastIndexAtOrBefore(analysis.beats, pos + 0.03, b => b.t) : -1;
  const eightIndex = analysis ? lastIndexAtOrBefore(analysis.eights, pos, e => e.start) : -1;
  const beat = analysis?.beats[beatIndex], eight = analysis?.eights[eightIndex];
  const saveMotif = (withBody: boolean) => {
    if (!onSaveMotif || !duration) return;
    const plan = planFor(analysis?.eights, analysis?.tempo ?? job.tempo, DEFAULT_CONFIG.aggregate.windows['8count_s']);
    const item = plan.kind === 'eights' ? [...plan.eights].reverse().find(e => e.start <= pos && pos < e.end) : undefined;
    const seconds = plan.kind === 'grid' ? plan.seconds : 4;
    if (plan.kind === 'eights' && !item) return;
    const start = item?.start ?? Math.floor(pos / seconds) * seconds;
    const end = Math.min(duration, item?.end ?? start + seconds);
    if (end <= start) return;
    const view = tracking.getView(), usage = view.usage['8count'];
    // A provisional take may be discarded; do not persist its movement in a standalone marker.
    const body = withBody && !recordingVideo && playing && view.status?.state === 'tracking' && usage?.tracking_ok ? usage.segments : undefined;
    onSaveMotif({ start, end, eightIndex: item?.index ?? null, ...(body && usage ? { body, level: usage.level } : {}), mix });
    setSaveRevision(value => value + 1);
    setSavedMotif(true); setTimeout(() => setSavedMotif(false), 2000);
  };
  const [suggestion, setSuggestion] = useState<CreativePrompt | null>(null);
  const [displayProposal, setDisplayProposal] = useState<DisplayProposal | null>(null);
  const [agentChoice, setAgentChoice] = useState<{ id: string; accept: boolean } | null>(null);
  const [character, setCharacter] = useState<'✦' | '☻' | '♪'>('✦');
  const [axes, setAxes] = useState<MovementAxis[]>(Object.keys(MOVEMENT_AXES) as MovementAxis[]);
  const [showAxes, setShowAxes] = useState(false);
  const [accepted, setAccepted] = useState<CreativePrompt | null>(null);
  const resolveSuggestion = (id: string, accept: boolean) => {
    if (displayProposal?.id === id) { setAgentChoice({ id, accept }); return; }
    if (!suggestion || suggestion.id !== id) return;
    if (accept) setAccepted(suggestion);
    setSuggestion(null);
  };
  const propose = () => setSuggestion(createCreativePrompt(axes));
  const name = job.name.replace(/\.[^.]+$/, '');
  if (error || loading) return (
    <View style={s.center}>
      <Text style={s.eyebrow}>CHOREOLAYER / SESSION</Text>
      {error ? <><Text style={s.errorTitle}>Could not open layers</Text><Text style={s.error}>{error}</Text><Pressable accessibilityRole="button" onPress={retry} style={s.primary}><Text style={s.primaryText}>Try again</Text></Pressable></>
        : <><ActivityIndicator color={C.accent} size="large" /><Text style={s.loadText}>{loading}</Text><Text style={s.small}>Layers play together once loaded.</Text></>}
      <Pressable accessibilityRole="button" onPress={onBack} style={s.backButton}><Text style={s.sub}>‹ Back to home</Text></Pressable>
    </View>
  );
  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.top}><Pressable accessibilityRole="button" disabled={recordingVideo} onPress={onBack} hitSlop={12} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }}><Icon name="arrow-back" size={21} color={C.text} /><Text style={s.back}>Save and exit</Text></Pressable><Text style={s.eyebrow}>MY SESSION</Text></View>
        {!!missionTitle && <Text style={[s.watchTitle, { marginBottom: 10 }]}>Mission · {missionTitle}</Text>}
        <View style={s.tabs}>{TABS.map(([key, title]) => <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: tab === key }} disabled={recordingVideo} onPress={() => setTab(key)} style={[s.tab, tab === key && s.tabOn]}><Text style={[s.tabText, tab === key && s.tabTextOn]}>{title}</Text></Pressable>)}</View>
        {tab === 'camera' && <CameraMixer mix={mix} master={master} onLayer={patch} onMaster={setMaster} />}
        {tab === 'camera' && <CameraTab store={tracking} playing={playing} loop={loopRange} saveRevision={saveRevision} missionTitle={missionTitle} onPlay={startPlayback} server={server} onSave={() => saveMotif(true)} saved={savedMotif} canRecord={!!onSaveVideo && !loopRange && !draft} recordCommand={recordCommand} onAgent={setDisplayProposal} agentChoice={agentChoice} onVideo={event => {
          if (event.state === 'pending') { setRecordingVideo(true); setVideoNotice(''); }
          else if (event.state === 'started') { tracking.beginTake(); videoStartedAt.current = Date.now(); videoOffset.current = 0; videoStart.current = player.current?.playing ? player.current.position : null; videoLast.current = videoStart.current ?? 0; }
          else if (event.state === 'error') { tracking.finishTake(false); videoStart.current = null; videoStartedAt.current = 0; setRecordingVideo(false); setVideoNotice(displayMessage(event.value)); }
          else { tracking.endTakeCapture(); const start = videoStart.current, current = player.current?.position ?? videoLast.current; const end = Math.min(duration, current > (start ?? 0) ? current : videoLast.current); videoStart.current = null; videoStartedAt.current = 0;
            if (start === null || end <= start || !onSaveVideo) { tracking.finishTake(false); try { discardTemporaryVideo(event.value); } catch {} setRecordingVideo(false); setVideoNotice("No music segment was recorded. Play the track and record again."); }
            else { draftRef.current = event.value; setDraft({ uri: event.value, start, end, mix, videoOffset: videoOffset.current, videoRate: playbackRate }); setVideoNotice('Review the recording before saving.'); }
          }
        }} />}
        {displayProposal && <View style={{ backgroundColor: C.card, borderRadius: 14, padding: 14, marginTop: 12, gap: 8 }}><Text style={s.watchTitle}>{displayProposal.symbol} {displayProposal.title}</Text><Text style={s.small}>{displayProposal.detail}</Text><View style={{ flexDirection: 'row', gap: 8 }}><Pressable accessibilityRole="button" style={s.reset} onPress={() => resolveSuggestion(displayProposal.id, true)}><Text style={s.resetText}>{displayProposal.kind === 'help' ? 'Yes, please' : 'Try it'}</Text></Pressable><Pressable accessibilityRole="button" style={s.reset} onPress={() => resolveSuggestion(displayProposal.id, false)}><Text style={s.resetText}>Not now</Text></Pressable></View></View>}
        {draft && <View style={{ gap: 10, marginTop: 14 }}><Text style={s.section}>Review recording</Text><VideoPreview uri={draft.uri} /><View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable accessibilityRole="button" disabled={savingVideo} style={s.reset} onPress={() => { tracking.finishTake(false); try { discardTemporaryVideo(draft.uri); } catch {} draftRef.current = null; setDraft(null); setRecordingVideo(false); setVideoNotice('Recording discarded.'); }}><Text style={s.resetText}>Discard</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={savingVideo} style={s.primary} onPress={() => { if (!onSaveVideo) return; setSavingVideo(true); void onSaveVideo(draft.uri, draft.start, draft.end, draft.mix, draft.videoOffset, draft.videoRate).then(() => { tracking.finishTake(true); draftRef.current = null; setDraft(null); setRecordingVideo(false); setSaveRevision(value => value + 1); setVideoNotice('Movement video saved to your workspace.'); }).catch(e => setVideoNotice(`Could not save video · ${displayMessage(e)}`)).finally(() => setSavingVideo(false)); }}><Text style={s.primaryText}>{savingVideo ? 'Saving…' : 'Save video'}</Text></Pressable>
        </View></View>}
        {!!videoNotice && <Text style={s.sub}>{videoNotice}</Text>}
        {/* The mixer stays mounted (watch haptics keep running) and is only hidden on the camera tab. */}
        <View style={tab === 'mixer' ? undefined : s.hidden}>
        <View style={s.hero}>{composition && <Text style={s.sub}>Composition practice · {composition.index + 1} / {composition.ranges.length} Clip</Text>}
          <View style={s.tag}><View style={s.statusDot} /><Text style={s.tagText}>{Object.keys(mix).length} LAYERS READY</Text></View>
          <Text style={s.title} numberOfLines={2}>{name}</Text>
          <Text style={s.sub}>{job.config.provider === 'lalal' ? 'LALAL.AI' : job.config.model === 'demo' ? "Demo track" : job.config.model === 'imported' ? "Imported layers" : 'Demucs'} · {fmtTime(duration)}{analysis?.tempo ? ` · ${Math.round(analysis.tempo)} BPM` : ''}</Text>
        </View>
        <View style={{ backgroundColor: C.card, borderRadius: 14, padding: 14, marginBottom: 16, gap: 8 }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><Pressable accessibilityRole="button" accessibilityLabel="Change character" onPress={() => setCharacter(character === '✦' ? '☻' : character === '☻' ? '♪' : '✦')} style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: C.cardHi, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 23, color: C.accent }}>{character}</Text></Pressable><View style={{ flex: 1 }}><Text style={s.watchTitle}>{suggestion ? `${suggestion.symbol}  ${suggestion.title}` : accepted ? `${accepted.symbol}  ${accepted.title}` : 'Movement ideas'}</Text><Text style={s.small}>{suggestion ? 'Choose here or on your watch.' : accepted ? 'Current idea · choose another anytime.' : 'Tap the character to change it.'}</Text></View></View>{suggestion ? <View style={{ flexDirection: 'row', gap: 8 }}><Pressable accessibilityRole="button" onPress={() => resolveSuggestion(suggestion.id, true)} style={s.reset}><Text style={s.resetText}>Try it</Text></Pressable><Pressable accessibilityRole="button" onPress={() => resolveSuggestion(suggestion.id, false)} style={s.reset}><Text style={s.resetText}>Not now</Text></Pressable></View> : <Pressable accessibilityRole="button" onPress={propose} style={{ alignSelf: 'flex-start', ...s.reset }}><Text style={s.resetText}>Get a suggestion</Text></Pressable>}<Pressable accessibilityRole="button" accessibilityState={{ expanded: showAxes }} onPress={() => setShowAxes(!showAxes)} style={{ minHeight: 36, justifyContent: 'center' }}><Text style={s.resetText}>{showAxes ? 'Close preferences' : `Choose feedback · ${axes.length}`}</Text></Pressable>{showAxes && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{(Object.keys(MOVEMENT_AXES) as MovementAxis[]).map(axis => <Pressable key={axis} accessibilityRole="checkbox" accessibilityState={{ checked: axes.includes(axis) }} onPress={() => setAxes(current => current.includes(axis) ? current.filter(item => item !== axis) : [...current, axis])} style={{ minHeight: 38, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 10, backgroundColor: axes.includes(axis) ? C.cardHi : C.bg }}><Text style={{ color: axes.includes(axis) ? C.accent : C.sub, fontSize: 11 }}>{MOVEMENT_AXES[axis].label}</Text></Pressable>)}</View>}{axes.length === 0 && <Text style={s.small}>Select at least one feedback type.</Text>}</View>
        <View style={s.sectionHead}><View><Text style={s.section}>Layer volume</Text><Text style={s.small}>Use the sliders to adjust each layer.</Text></View><Pressable accessibilityRole="button" accessibilityLabel={"Reset mix"} onPress={reset} style={s.reset}><Text style={s.resetText}>Reset ↺</Text></Pressable></View>
        <View style={s.layerGrid}>{Object.keys(mix).map((stem, index) => <View key={stem} style={{ width: twoColumns ? '48.5%' : '100%' }}><StemRow key={stem} stem={stem} index={index} volume={mix[stem].volume} muted={mix[stem].muted} solo={mix[stem].solo} audible={layerGain(mix, stem) > 0} level={playing ? levels[stem] ?? 0 : 0} waveform={waveforms[stem] ?? []} progress={duration ? pos / duration : 0} onVolume={value => patch(stem, { volume: value })} onMute={() => patch(stem, { muted: !mix[stem].muted })} onSolo={() => patch(stem, { solo: !mix[stem].solo })} /></View>)}</View>
        <View style={s.master}><View style={s.masterHead}><Text style={s.masterLabel}>Master volume</Text><Text style={s.masterValue}>{Math.round(master * 100)}%</Text></View><Slider accessibilityLabel={"Master volume"} style={s.masterSlider} minimumValue={0} maximumValue={1} step={0.01} value={master} onValueChange={setMaster} minimumTrackTintColor={C.text} maximumTrackTintColor={C.line} thumbTintColor={C.text} /></View>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: showWatch }} onPress={() => setShowWatch(!showWatch)} style={s.watchToggle}><View><Text style={s.watchTitle}>Watch controls</Text><Text style={s.small}>Layer controls · beat haptics</Text></View><Text style={s.sub}>{showWatch ? "Collapse −" : "View +"}</Text></Pressable>
        <View style={showWatch ? undefined : s.hidden}>
        {loadedPlayer && <WatchMixerCard mix={mix} master={master} suggestion={displayProposal ?? suggestion} notifySuggestion={displayProposal?.kind === 'help'} recordAvailable={tab === 'camera' && !draft && !!onSaveVideo && !loopRange} recording={recordingVideo} onRecord={() => setRecordCommand(value => value + 1)} onSuggestion={resolveSuggestion} onCommands={commands => { setMix(previous => applyWatchMixerCommands(previous, commands)); setMaster(previous => applyWatchMasterCommands(previous, commands)); }} />}
        {loadedPlayer && <WatchHapticsCard player={loadedPlayer} playing={playing} rate={playbackRate} loopKey={JSON.stringify(loopRange)} transportBusy={transportBusy} />}
        </View>
        {onSaveMotif && <Pressable accessibilityRole="button" onPress={() => saveMotif(false)} style={s.reset}><Text style={s.resetText}>{savedMotif ? "Saved ✓" : "Save this 8-count"}</Text></Pressable>}
        {analysis && <>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: showAnalysis }} style={s.analysisToggle} onPress={() => setShowAnalysis(value => !value)}><Text style={s.sub}>Beats and sections</Text><Text style={s.sub}>{showAnalysis ? '−' : '+'}</Text></Pressable>
          {showAnalysis && <View style={s.analysisCard}>
            <View style={s.countRow}><Text style={s.count}>{beat?.count ?? '–'}<Text style={s.countOf}> / 8</Text></Text><Text style={s.sub}>{eight ? `${eight.index + 1} 8-count` : "Intro"}</Text><Pressable accessibilityRole="button" disabled={!eight} style={s.reset} onPress={() => perform(async p => { const range = eight ? { start: eight.start, end: Math.min(eight.end, duration) } : null; await p.setLoop(range); setLoopRange(range); })}><Text style={s.resetText}>Repeat this section</Text></Pressable></View>
            <Timeline a={analysis} pos={pos} loop={loopRange} onSeek={seek} />
            {analysis.sections.map((section, i) => <Pressable accessibilityRole="button" key={i} style={s.sectionRow} onPress={() => seek(section.start)}><Text style={s.sectionLabel}>{section.label}</Text><Text style={s.sub}>{fmtTime(section.start)} – {fmtTime(section.end)}</Text><Text style={s.sectionStems} numberOfLines={1}>{section.activeStems.map(stem => STEM_LABELS[stem] ?? stem).join(' · ')}</Text></Pressable>)}
          </View>}
        </>}
        {!!analysisNotice && <Text style={s.small}>{analysisNotice}</Text>}
        </View>
        {onFinish && <Pressable accessibilityRole="button" disabled={recordingVideo} onPress={() => { void perform(async p => { await p.pause(); onFinish(withTracking(tracking, { ...latest.current, position: p.position, listened: listened.current, layerSeconds: { ...layerSeconds.current } })); }); }} style={[s.primary, { marginTop: 24, alignItems: 'center' }]}><Text style={s.primaryText}>End session and save</Text></Pressable>}
      </ScrollView>
      <View style={s.dock}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}><Text style={s.time}>Speed</Text>{[0.5, 0.75, 1, 1.25, 1.5].map(rate => <Pressable accessibilityRole="button" accessibilityState={{ selected: playbackRate === rate, disabled: recordingVideo }} disabled={recordingVideo} key={rate} onPress={() => { setPlaybackRate(rate); void player.current?.setPlaybackRate(rate).catch(e => setError(displayMessage(e))); }} style={{ paddingHorizontal: 9, paddingVertical: 6, borderRadius: 10, backgroundColor: playbackRate === rate ? C.cardHi : 'transparent', opacity: recordingVideo ? 0.5 : 1 }}><Text style={{ color: playbackRate === rate ? C.accent : C.sub, fontSize: 11 }}>{rate}×</Text></Pressable>)}</View>
        <View style={s.timeRow}><Text style={s.time}>{fmtTime(pos)}</Text><Text style={s.time}>{fmtTime(duration)}</Text></View>
        <Slider accessibilityLabel={"Playback position"} disabled={recordingVideo} style={s.seekSlider} minimumValue={0} maximumValue={duration || 1} value={pos} minimumTrackTintColor={C.accent} maximumTrackTintColor={C.line} thumbTintColor={C.accent} onSlidingStart={() => setScrubbing(true)} onValueChange={setPos} onSlidingComplete={time => { setScrubbing(false); void seek(time); }} />
        <View style={s.transport}>
          <Pressable accessibilityRole="button" accessibilityLabel={"Repeat track"} accessibilityState={{ selected: !!loopRange }} disabled={transportBusy || recordingVideo} onPress={() => perform(async p => { const range = loopRange ? null : { start: 0, end: duration }; await p.setLoop(range); setLoopRange(range); })} style={[s.sideButton, loopRange && s.repeatOn]}><Text style={[s.sideText, loopRange && { color: C.accent }]}>↻</Text><Text style={s.transportHint}>{loopRange ? "Repeating" : "Repeat"}</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={"Back 10 seconds"} disabled={transportBusy || recordingVideo} onPress={() => seek(pos - 10)} style={s.sideButton}><Text style={s.skip}>−10</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={playing ? "Pause" : "Play"} disabled={transportBusy || !!draft || (recordingVideo && playing)} style={[s.play, transportBusy && { opacity: 0.6 }]} onPress={() => perform(p => p.playing ? p.pause() : playMusic(p))}><Text style={s.playIcon}>{playing ? 'Ⅱ' : '▶'}</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={"Forward 10 seconds"} disabled={transportBusy || recordingVideo} onPress={() => seek(pos + 10)} style={s.sideButton}><Text style={s.skip}>+10</Text></Pressable>
          <View style={s.sideButton}><View style={[s.liveDot, playing && { backgroundColor: C.accent }]} /><Text style={s.transportHint}>{playing ? "Playing" : "Ready"}</Text></View>
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
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderColor: C.line, marginBottom: 18 },
  tab: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent', marginBottom: -1 },
  tabOn: { borderBottomColor: C.accent },
  tabText: { color: C.sub, fontSize: 13, fontFamily: 'SpaceGrotesk_600SemiBold' },
  tabTextOn: { color: C.accent },
  hidden: { display: 'none' },
  layerGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  watchToggle: { marginTop: 12, padding: 14, borderRadius: 16, backgroundColor: C.card, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 56 },
  watchTitle: { color: C.text, fontSize: 14, fontFamily: 'SpaceGrotesk_600SemiBold' },
  root: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center' }, content: { paddingHorizontal: 22, paddingBottom: 24 }, top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, paddingBottom: 14 }, back: { color: C.sub, fontSize: 13 }, eyebrow: { color: C.dim, fontSize: 10, fontFamily: 'SpaceGrotesk_600SemiBold', letterSpacing: 2.4 },
  hero: { marginBottom: 18 }, tag: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 12 }, statusDot: { width: 5, height: 5, backgroundColor: C.accent, borderRadius: 3 }, tagText: { color: C.accent, fontSize: 9, fontFamily: 'SpaceGrotesk_600SemiBold', letterSpacing: 1.8 }, title: { color: C.text, fontSize: 25, lineHeight: 32, fontFamily: 'SpaceGrotesk_600SemiBold', letterSpacing: -1.1, marginBottom: 8 }, sub: { color: C.sub, fontSize: 12 }, small: { color: C.dim, fontSize: 11, lineHeight: 18, marginTop: 5 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 8 }, section: { color: C.text, fontSize: 18, fontFamily: 'SpaceGrotesk_600SemiBold' }, reset: { paddingHorizontal: 10, paddingVertical: 10, borderRadius: 8, backgroundColor: C.cardHi }, resetText: { color: C.sub, fontSize: 11 },
  master: { paddingHorizontal: 16, paddingTop: 6, marginTop: 10 }, masterHead: { flexDirection: 'row', justifyContent: 'space-between' }, masterLabel: { color: C.sub, fontSize: 12 }, masterValue: { color: C.text, fontSize: 12, fontVariant: ['tabular-nums'] }, masterSlider: { height: 36 },
  dock: { borderTopWidth: 1, borderColor: C.line, backgroundColor: C.bg, paddingHorizontal: 24, paddingTop: 10, paddingBottom: 14 }, timeRow: { flexDirection: 'row', justifyContent: 'space-between' }, time: { color: C.sub, fontSize: 10, fontVariant: ['tabular-nums'] }, seekSlider: { height: 26 }, transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', paddingTop: 6 }, play: { width: 60, height: 60, borderRadius: 30, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' }, playIcon: { color: C.bg, fontSize: 24, fontFamily: 'SpaceGrotesk_600SemiBold' }, sideButton: { width: 46, minHeight: 44, alignItems: 'center', justifyContent: 'center', gap: 3 }, sideText: { color: C.sub, fontSize: 24 }, skip: { color: C.text, fontSize: 14, fontFamily: 'SpaceGrotesk_600SemiBold' }, transportHint: { color: C.dim, fontSize: 8 }, liveDot: { width: 6, height: 6, backgroundColor: C.dim, borderRadius: 3 }, repeatOn: { backgroundColor: C.card, borderRadius: 12 },
  analysisToggle: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 20, borderTopWidth: 1, borderColor: C.line, marginTop: 16 }, analysisCard: { gap: 12, paddingBottom: 12 }, countRow: { flexDirection: 'row', alignItems: 'center', gap: 12 }, count: { color: C.text, fontSize: 28, fontFamily: 'SpaceGrotesk_600SemiBold' }, countOf: { color: C.dim, fontSize: 14 }, sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }, sectionLabel: { color: C.accent, fontFamily: 'SpaceGrotesk_600SemiBold' }, sectionStems: { color: C.dim, fontSize: 10, flex: 1, textAlign: 'right' }, footerNote: { color: C.dim, fontSize: 10, textAlign: 'center', marginTop: 28 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 16 }, errorTitle: { color: C.text, fontSize: 24, fontFamily: 'SpaceGrotesk_600SemiBold' }, error: { color: C.err, lineHeight: 22, textAlign: 'center' }, primary: { backgroundColor: C.accent, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 14 }, primaryText: { color: C.bg, fontFamily: 'SpaceGrotesk_600SemiBold' }, backButton: { padding: 14 }, loadText: { color: C.text, fontSize: 16 },
});
