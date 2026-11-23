import { Text } from '../../ui/Typography';
import { displayMessage } from '../../ui/displayMessage';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import PoseCameraView, { type PoseCameraHandle } from '../../../modules/pose-camera';
import { DEFAULT_CONFIG, detectorJson } from '../../tracking/config';
import { IDLE, nextStart, secondsLeft, type StartEvent, type StartPhase } from '../../tracking/danceStart';
import { unexploredTargets } from '../../tracking/insights';
import { LEVEL_NAMES, label } from '../../tracking/phrases';
import type { LiveTrackingStore, TrackingView } from '../../tracking/store';
import { C } from '../../theme';
import BodyUsageBars from './BodyUsageBars';
import BodyHeatmap from './BodyHeatmap';
import { fromSegments } from '../../tracking/bodyMap';
import { floorTransform, type Point } from '../../projection/heatmap';
import SkeletonOverlay from './SkeletonOverlay';
import ProjectionCard, { type DisplayProposal } from './ProjectionCard';

const BOX_ASPECT = 3 / 4; // upright 4:3 camera frame, no crop
const DETECTOR = detectorJson();
const PLAN_NOTE = { eights: '', tempo: "8 beats based on BPM", fixed: `No beat data · ${DEFAULT_CONFIG.aggregate.windows['8count_s']}-second intervals`, rolling: '' } as const;

type Props = { projectId: string; sessionId: string; store: LiveTrackingStore; playing: boolean; onPlay: () => void; server: string; onSave?: () => void; saved?: boolean; loop: { start: number; end: number } | null; saveRevision: number; missionTitle?: string; canRecord: boolean; recordCommand: number; onAgent: (proposal: DisplayProposal | null) => void; agentChoice: { id: string; accept: boolean } | null; onVideo: (event: { state: 'started' | 'saved' | 'error' | 'pending'; value: string }) => void };

function statusText(view: TrackingView, phase: StartPhase, now: number, playing: boolean): string {
  if (view.error) return view.error;
  if (phase.kind === 'countdown') return `${secondsLeft(phase, now)} seconds until start · get into position`;
  const state = view.status?.state;
  if (state === 'calibrating') return `Hold still for ${DEFAULT_CONFIG.calibration.duration_s} sec · ${Math.round((view.status?.progress ?? 0) * 100)}%`;
  if (!state || state === 'waiting') return "Stand in front of the camera with your full body visible.";
  if (!playing) return "Paused · tracking stopped";
  if (!view.usage['8count']?.tracking_ok) return "Body not fully visible · adjust your position";
  return "Tracking";
}

const hudText = ({ perf, engine }: TrackingView) =>
  perf ? `${perf.pose_fps}fps · ${perf.lat_ms.capture_pose.p50 ?? '–'} ms · detection ${Math.round(perf.detect_rate * 100)}% · ${engine.delegate}` : '';

/** The session's camera tab: preview + skeleton, what has been used, and [춤 시작]. */
export default function CameraTab({ projectId, sessionId, store, playing, onPlay, server, onSave, saved, loop, saveRevision, missionTitle, canRecord, recordCommand, onAgent, agentChoice, onVideo }: Props) {
  const view = useSyncExternalStore(store.subscribe, store.getView);
  const { width, fontScale } = useWindowDimensions();
  const sideBySide = width >= 360 && fontScale <= 1.2;
  const [showProjection, setShowProjection] = useState(false);
  const cameraRef = useRef<PoseCameraHandle>(null);
  const [videoState, setVideoState] = useState<'idle' | 'starting' | 'recording' | 'stopping'>('idle'), [videoMessage, setVideoMessage] = useState('');
  const [permission, setPermission] = useState<'asking' | 'granted' | 'denied'>('asking');
  const [corners, setCorners] = useState<Point[]>([]), [calibratingFloor, setCalibratingFloor] = useState(false);
  const [cameraSize, setCameraSize] = useState({ width: 1, height: 1 });
  const [details, setDetails] = useState(false);
  const [windowName, setWindowName] = useState<'8count' | 'session'>('8count');
  const [phase, setPhase] = useState<StartPhase>(IDLE);
  const [now, setNow] = useState(() => Date.now());
  const phaseRef = useRef<StartPhase>(IDLE);
  const playingRef = useRef(playing);
  const onPlayRef = useRef(onPlay);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { onPlayRef.current = onPlay; }, [onPlay]);

  const toggleRecording = useCallback(() => {
    if (videoState === 'idle' && canRecord) { const camera = cameraRef.current; if (!camera) { setVideoMessage('Wait for the camera to be ready.'); return; } setVideoState('starting'); setVideoMessage('Preparing camera…'); onVideo({ state: 'pending', value: '' }); void camera.startRecording().catch(e => { setVideoState('idle'); setVideoMessage(displayMessage(e)); onVideo({ state: 'error', value: displayMessage(e) }); }); }
    else if (videoState === 'recording') { setVideoState('stopping'); void cameraRef.current?.stopRecording().catch(e => { setVideoState('idle'); setVideoMessage(displayMessage(e)); onVideo({ state: 'error', value: displayMessage(e) }); }); }
  }, [videoState, canRecord, onVideo]);
  const lastRecordCommand = useRef(recordCommand);
  useEffect(() => { if (lastRecordCommand.current !== recordCommand) { lastRecordCommand.current = recordCommand; toggleRecording(); } }, [recordCommand, toggleRecording]);

  const dispatch = useCallback((ev: StartEvent) => {
    const r = nextStart(phaseRef.current, ev);
    phaseRef.current = r.phase;
    setPhase(r.phase);
    for (const action of r.actions) {
      if (action === 'recalibrate') store.recalibrate();
      else onPlayRef.current();
    }
  }, [store]);

  // Leaving the tab or the screen unmounts this component: end any running countdown/calibration wait.
  useEffect(() => () => { dispatch({ type: 'cancel' }); }, [dispatch]);

  useFocusEffect(useCallback(() => {
    if (!PoseCameraView) return;
    let alive = true;
    void ImagePicker.getCameraPermissionsAsync().then(r => { if (alive) setPermission(r.granted ? 'granted' : 'denied'); }).catch(() => { if (alive) setPermission('denied'); });
    return () => { alive = false; };
  }, []));

  // Check the permission configured in Settings and refresh when returning to the app.
  useEffect(() => {
    if (!PoseCameraView) return;
    let alive = true;
    const check = () => ImagePicker.getCameraPermissionsAsync()
      .then(r => { if (alive) setPermission(r.granted ? 'granted' : 'denied'); })
      .catch(() => { if (alive) setPermission('denied'); });
    void check();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') void check();
      else dispatch({ type: 'cancel' }); // leaving the app ends a pending countdown / calibration wait
    });
    return () => { alive = false; sub.remove(); };
  }, [dispatch]);

  // Drives the countdown and waits for calibration while [춤 시작] is running.
  useEffect(() => {
    if (phase.kind === 'idle') return;
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      dispatch({ type: 'tick', nowMs: t, state: store.trackerState, playing: playingRef.current });
    }, 200);
    return () => clearInterval(timer);
  }, [phase.kind, dispatch, store]);

  if (!PoseCameraView) return (
    <View style={s.card}>
      <Text style={s.title}>Camera tracking is available only in the Android app</Text>
      <Text style={s.body}>The mixer is still available.</Text>
    </View>
  );
  if (permission === 'denied') return (
    <View style={s.card}>
      <Text style={s.title}>Camera permission required</Text>
      <Text style={s.body}>Camera access is required for motion tracking. Video is not saved or sent unless you record it.</Text>
      <Pressable accessibilityRole="button" onPress={() => router.push('/settings')} style={s.secondary}><Text style={s.secondaryText}>Open settings</Text></Pressable>
    </View>
  );

  const usage = view.usage[windowName];
  const dim = !playing || !usage?.tracking_ok || view.status?.state !== 'tracking'; // the usage kept after [다시 맞추기] is stale
  const targets = usage ? unexploredTargets(usage.underused, usage.level, DEFAULT_CONFIG.feedback.level_min_share) : [];
  const count = view.count === null ? (view.plan === 'eights' ? "Intro" : '') : `${view.count} / 8`;
  const busy = phase.kind !== 'idle';
  // Readable from 2.5-3 m: the countdown seconds, then the stand-still progress, large over the preview.
  const big = phase.kind === 'countdown' ? String(secondsLeft(phase, now))
    : view.status?.state === 'calibrating' ? `${Math.round((view.status.progress ?? 0) * 100)}%` : '';
  return (
    <View style={s.root}>
      <View style={s.cameraRow}><View style={s.camera} onLayout={e => setCameraSize(e.nativeEvent.layout)}>
        {permission === 'granted' && (
          <PoseCameraView ref={cameraRef} style={StyleSheet.absoluteFill} active model="lite" detectorJson={DETECTOR}
            onRecording={e => { const event = e.nativeEvent; onVideo(event); if (event.state === 'started') { setVideoState('recording'); setVideoMessage("Recording video"); } else { setVideoState('idle'); setVideoMessage(event.state === 'error' ? displayMessage(event.value) : "Recording ready to review."); } }}
            onPose={e => store.handlePose(e.nativeEvent)} onEngine={e => store.handleEngine(e.nativeEvent)} onError={e => store.handleError(displayMessage(e.nativeEvent.message))} />
        )}
        <SkeletonOverlay pose={view.pose} shares={view.usage.session?.segments ?? null} underused={usage?.underused ?? []}
          boxAspect={BOX_ASPECT} visibility={DEFAULT_CONFIG.pose.visibility_threshold} />
        {!!big && <View style={s.bigWrap} pointerEvents="none"><Text style={s.big} accessibilityElementsHidden>{big}</Text></View>}
        <Text style={s.hud}>{hudText(view)}</Text>
        {calibratingFloor && <Pressable accessibilityRole="button" accessibilityLabel={"Set floor corners"} style={StyleSheet.absoluteFill} onPress={e => {
          const next = [...corners, { x: e.nativeEvent.locationX / cameraSize.width, y: e.nativeEvent.locationY / cameraSize.height }];
          if (next.length === 4 && !floorTransform(next)) { setCorners([]); return; }
          setCorners(next); if (next.length === 4) setCalibratingFloor(false);
        }}>{corners.map((point, i) => <View key={i} style={{ position: 'absolute', left: `${point.x * 100}%`, top: `${point.y * 100}%`, width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFF', alignItems: 'center' }}><Text>{i + 1}</Text></View>)}</Pressable>}
      </View>
      <View style={s.heatFigure}>{usage ? <BodyHeatmap shares={fromSegments(usage.segments)} underused={usage.underused} dim={dim} /> : <Text style={s.small}>Movement appears when tracking starts.</Text>}</View></View>
      <Text style={s.status} accessibilityLiveRegion="polite">{statusText(view, phase, now, playing)}</Text>
      <View style={s.head}>
        <View style={s.switch}>
          {(['8count', 'session'] as const).map(w => (
            <Pressable key={w} accessibilityRole="button" accessibilityState={{ selected: windowName === w }} onPress={() => setWindowName(w)} style={[s.switchItem, windowName === w && s.switchOn]}>
              <Text style={[s.switchText, windowName === w && s.switchTextOn]}>{w === '8count' ? "Current 8-count" : "Full session"}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={s.count}>{count}</Text>
      </View>
      {!!PLAN_NOTE[view.plan] && <Text style={s.small}>{PLAN_NOTE[view.plan]}</Text>}
      {usage ? (
        <>
          <Pressable accessibilityRole="button" onPress={() => setDetails(!details)}><Text style={s.secondaryText}>{details ? "Collapse" : "Details"}</Text></Pressable>
          {details && <BodyUsageBars segments={usage.segments} underused={usage.underused} dim={dim} />}
          <Text style={[s.body, dim && s.dim]}>Height  {(['low', 'mid', 'high'] as const).map(l => `${LEVEL_NAMES[l]} ${Math.round(usage.level[l] * 100)}`).join(' · ')}</Text>
          {targets.length > 0 && <Text style={[s.body, dim && s.dim]}>Less-used areas: {targets.map(t => label(t)).join(' · ')}</Text>}
        </>
      ) : <Text style={s.body}>Movement by body part appears when tracking starts.</Text>}
      {view.cue && <Text style={s.cue}>&quot;{view.cue.text}&quot;</Text>}
      <View style={s.actions}>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: playing || busy }} disabled={playing || busy} style={[s.primary, (playing || busy) && s.off]}
          onPress={() => {
            const t = Date.now();
            setNow(t); // the countdown readout must not show the time since the last tick
            dispatch({ type: 'press', nowMs: t, calibrated: store.calibrated, countdownMs: 1000 * DEFAULT_CONFIG.app.countdown_s });
          }}>
          <Text style={s.primaryText}>Start dancing</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: phase.kind === 'countdown' }} disabled={phase.kind === 'countdown'} style={[s.secondary, phase.kind === 'countdown' && s.off]}
          onPress={() => { dispatch({ type: 'cancel' }); store.requestRecalibration(); }}>
          <Text style={s.secondaryText}>Recalibrate</Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: sideBySide ? 'row' : 'column', gap: 8 }}>
      <Pressable accessibilityRole="button" disabled={videoState === 'starting' || videoState === 'stopping' || (videoState === 'idle' && !canRecord)} style={[s.secondary, { flex: sideBySide ? 1 : undefined }, (videoState === 'idle' && !canRecord) && s.off]} onPress={toggleRecording}><Text style={s.secondaryText}>{videoState === 'recording' ? "Stop recording" : videoState === 'idle' ? "Start recording" : "Processing video…"}</Text></Pressable>
      {!!onSave && <Pressable accessibilityRole="button" onPress={onSave} style={[s.secondary, { flex: sideBySide ? 1 : undefined }]}><Text style={s.secondaryText}>{saved ? "Saved ✓" : "Save this 8-count"}</Text></Pressable>}
      </View>
      <Text style={s.small}>Record before or during playback. Up to 60 seconds · no audio.</Text>
      {!!loop && <Text style={s.small}>Turn off repeat before recording to keep the video aligned with the music timeline.</Text>}
      {!!videoMessage && <Text style={s.small}>{videoMessage}</Text>}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: showProjection }} onPress={() => setShowProjection(!showProjection)} style={s.projectionToggle}><View><Text style={s.projectionTitle}>Connect projection display</Text><Text style={s.small}>Projector · floor area</Text></View><Text style={s.secondaryText}>{showProjection ? "Collapse −" : "Set up +"}</Text></Pressable>
      <View style={showProjection ? { gap: 10 } : { display: 'none' }}>
      <ProjectionCard projectId={projectId} sessionId={sessionId} store={store} server={server} playing={playing} recording={videoState === 'recording'} loop={loop} saveRevision={saveRevision} missionTitle={missionTitle} corners={corners} onAgent={onAgent} choice={agentChoice} />
      <Pressable accessibilityRole="button" onPress={() => { setCorners([]); setCalibratingFloor(true); }} style={s.secondary}><Text style={s.secondaryText}>Calibrate floor projection</Text></Pressable>
      <Text style={s.small}>{calibratingFloor ? `Tap the projection corners in the camera view: top left → top right → bottom right → bottom left. (${corners.length}/4)` : corners.length === 4 ? "Floor area set. Recalibrate if the camera or projector moves." : "Select the four projector corners in the camera view to align the floor display."}</Text>
      </View>
      <Text style={s.small}>Only videos you choose to record are saved to this device.</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { gap: 14 },
  projectionToggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, backgroundColor: C.card, borderRadius: 16, minHeight: 56 },
  projectionTitle: { color: C.text, fontSize: 14, fontFamily: 'SpaceGrotesk_600SemiBold' },
  cameraRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heatFigure: { flex: 1 },
  camera: { width: '45%', aspectRatio: BOX_ASPECT, borderRadius: 24, overflow: 'hidden', backgroundColor: C.text },
  bigWrap: { ...StyleSheet.absoluteFill,alignItems: 'center', justifyContent: 'center' },
  big: { color: C.accent, fontSize: 96, lineHeight: 110, fontFamily: 'SpaceGrotesk_600SemiBold', fontVariant: ['tabular-nums'], textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 8 },
  hud: { position: 'absolute', left: 12, bottom: 10, color: '#FFFFFF', fontSize: 10, fontVariant: ['tabular-nums'] },
  status: { color: C.text, fontSize: 15, fontFamily: 'SpaceGrotesk_600SemiBold' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  switch: { flexDirection: 'row', backgroundColor: C.card, borderRadius: 12, padding: 3 },
  switchItem: { paddingHorizontal: 12, minHeight: 36, borderRadius: 9, justifyContent: 'center' },
  switchOn: { backgroundColor: C.cardHi },
  switchText: { color: C.sub, fontSize: 12 },
  switchTextOn: { color: C.accent, fontFamily: 'SpaceGrotesk_600SemiBold' },
  count: { color: C.text, fontSize: 22, fontFamily: 'SpaceGrotesk_600SemiBold', fontVariant: ['tabular-nums'] },
  body: { color: C.sub, fontSize: 13, lineHeight: 20 },
  small: { color: C.dim, fontSize: 11, lineHeight: 17 },
  dim: { opacity: 0.45 },
  cue: { color: C.accent, fontSize: 15, lineHeight: 22, fontFamily: 'SpaceGrotesk_600SemiBold' },
  actions: { flexDirection: 'row', gap: 10 },
  primary: { flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#FFFFFF', fontFamily: 'SpaceGrotesk_600SemiBold' },
  secondary: { flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: C.cardHi, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: C.accent, fontFamily: 'SpaceGrotesk_600SemiBold' },
  off: { opacity: 0.4 },
  card: { backgroundColor: C.card, borderRadius: 20, padding: 20, gap: 10 },
  title: { color: C.text, fontSize: 16, fontFamily: 'SpaceGrotesk_600SemiBold' },
});
