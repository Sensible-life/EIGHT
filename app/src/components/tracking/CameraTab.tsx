import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import PoseCameraView from '../../../modules/pose-camera';
import { DEFAULT_CONFIG, detectorJson } from '../../tracking/config';
import { IDLE, nextStart, secondsLeft, type StartEvent, type StartPhase } from '../../tracking/danceStart';
import { unexploredTargets } from '../../tracking/insights';
import { LEVEL_NAMES, label } from '../../tracking/phrases';
import type { LiveTrackingStore, TrackingView } from '../../tracking/store';
import { C } from '../../theme';
import BodyUsageBars from './BodyUsageBars';
import SkeletonOverlay from './SkeletonOverlay';

const BOX_ASPECT = 3 / 4; // upright 4:3 camera frame, no crop
const DETECTOR = detectorJson();
const PLAN_NOTE = { eights: '', tempo: 'BPM 기준 8박 단위', fixed: `박자 정보 없음 · ${DEFAULT_CONFIG.aggregate.windows['8count_s']}초 단위`, rolling: '' } as const;

type Props = { store: LiveTrackingStore; playing: boolean; onPlay: () => void };

function statusText(view: TrackingView, phase: StartPhase, now: number, playing: boolean): string {
  if (view.error) return view.error;
  if (phase.kind === 'countdown') return `${secondsLeft(phase, now)}초 뒤 시작 · 자리를 잡아 주세요`;
  const state = view.status?.state;
  if (state === 'calibrating') return `가만히 ${DEFAULT_CONFIG.calibration.duration_s}초 · ${Math.round((view.status?.progress ?? 0) * 100)}%`;
  if (!state || state === 'waiting') return '카메라 앞에 서 주세요 · 몸 전체가 보이게';
  if (!playing) return '일시정지 · 집계 멈춤';
  if (!view.usage['8count']?.tracking_ok) return '잘 안 보여요 · 몸 전체가 화면에 들어오게 서 주세요';
  return '트래킹 중';
}

const hudText = ({ perf, engine }: TrackingView) =>
  perf ? `${perf.pose_fps}fps · ${perf.lat_ms.capture_pose.p50 ?? '–'}ms · 인식 ${Math.round(perf.detect_rate * 100)}% · ${engine.delegate}` : '';

/** The session's camera tab: preview + skeleton, what has been used, and [춤 시작]. */
export default function CameraTab({ store, playing, onPlay }: Props) {
  const view = useSyncExternalStore(store.subscribe, store.getView);
  const [permission, setPermission] = useState<'asking' | 'granted' | 'denied'>('asking');
  const [windowName, setWindowName] = useState<'8count' | 'session'>('8count');
  const [phase, setPhase] = useState<StartPhase>(IDLE);
  const [now, setNow] = useState(() => Date.now());
  const phaseRef = useRef<StartPhase>(IDLE);
  const playingRef = useRef(playing);
  const onPlayRef = useRef(onPlay);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { onPlayRef.current = onPlay; }, [onPlay]);

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

  // Camera permission: ask once, re-check when coming back from the system settings.
  useEffect(() => {
    if (!PoseCameraView) return;
    let alive = true;
    const check = (ask: boolean) => (ask ? ImagePicker.requestCameraPermissionsAsync() : ImagePicker.getCameraPermissionsAsync())
      .then(r => { if (alive) setPermission(r.granted ? 'granted' : 'denied'); })
      .catch(() => { if (alive) setPermission('denied'); });
    void check(true);
    const sub = AppState.addEventListener('change', state => { if (state === 'active') void check(false); });
    return () => { alive = false; sub.remove(); };
  }, []);

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
      <Text style={s.title}>카메라 트래킹은 Android 앱에서만 쓸 수 있어요</Text>
      <Text style={s.body}>믹서 탭은 그대로 쓸 수 있어요.</Text>
    </View>
  );
  if (permission === 'denied') return (
    <View style={s.card}>
      <Text style={s.title}>카메라 권한이 필요해요</Text>
      <Text style={s.body}>몸의 움직임을 보려면 카메라가 필요해요. 영상은 화면에만 보이고 저장하거나 보내지 않아요.</Text>
      <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings()} style={s.secondary}><Text style={s.secondaryText}>설정 열기</Text></Pressable>
    </View>
  );

  const usage = view.usage[windowName];
  const dim = !playing || !usage?.tracking_ok;
  const targets = usage ? unexploredTargets(usage.underused, usage.level, DEFAULT_CONFIG.feedback.level_min_share) : [];
  const count = view.count === null ? (view.plan === 'eights' ? '도입' : '') : `${view.count} / 8`;
  const busy = phase.kind !== 'idle';
  // Readable from 2.5-3 m: the countdown seconds, then the stand-still progress, large over the preview.
  const big = phase.kind === 'countdown' ? String(secondsLeft(phase, now))
    : view.status?.state === 'calibrating' ? `${Math.round((view.status.progress ?? 0) * 100)}%` : '';
  return (
    <View style={s.root}>
      <View style={s.camera}>
        {permission === 'granted' && (
          <PoseCameraView style={StyleSheet.absoluteFill} active model="lite" detectorJson={DETECTOR}
            onPose={e => store.handlePose(e.nativeEvent)} onEngine={e => store.handleEngine(e.nativeEvent)} onError={e => store.handleError(e.nativeEvent.message)} />
        )}
        <SkeletonOverlay pose={view.pose} shares={view.usage.session?.segments ?? null} underused={usage?.underused ?? []}
          boxAspect={BOX_ASPECT} visibility={DEFAULT_CONFIG.pose.visibility_threshold} />
        {!!big && <View style={s.bigWrap} pointerEvents="none"><Text style={s.big} accessibilityElementsHidden>{big}</Text></View>}
        <Text style={s.hud}>{hudText(view)}</Text>
      </View>
      <Text style={s.status} accessibilityLiveRegion="polite">{statusText(view, phase, now, playing)}</Text>
      <View style={s.head}>
        <View style={s.switch}>
          {(['8count', 'session'] as const).map(w => (
            <Pressable key={w} accessibilityRole="button" accessibilityState={{ selected: windowName === w }} onPress={() => setWindowName(w)} style={[s.switchItem, windowName === w && s.switchOn]}>
              <Text style={[s.switchText, windowName === w && s.switchTextOn]}>{w === '8count' ? '이번 8카운트' : '세션 전체'}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={s.count}>{count}</Text>
      </View>
      {!!PLAN_NOTE[view.plan] && <Text style={s.small}>{PLAN_NOTE[view.plan]}</Text>}
      {usage ? (
        <>
          <BodyUsageBars segments={usage.segments} underused={usage.underused} dim={dim} />
          <Text style={[s.body, dim && s.dim]}>높이  {(['low', 'mid', 'high'] as const).map(l => `${LEVEL_NAMES[l]} ${Math.round(usage.level[l] * 100)}`).join(' · ')}</Text>
          {targets.length > 0 && <Text style={[s.body, dim && s.dim]}>안 가본 쪽: {targets.map(t => label(t)).join(' · ')}</Text>}
        </>
      ) : <Text style={s.body}>트래킹이 시작되면 부위별 비율이 여기에 보여요.</Text>}
      {view.cue && <Text style={s.cue}>&quot;{view.cue.text}&quot;</Text>}
      <View style={s.actions}>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: playing || busy }} disabled={playing || busy} style={[s.primary, (playing || busy) && s.off]}
          onPress={() => dispatch({ type: 'press', nowMs: Date.now(), calibrated: store.calibrated, countdownMs: 1000 * DEFAULT_CONFIG.app.countdown_s })}>
          <Text style={s.primaryText}>춤 시작</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: phase.kind === 'countdown' }} disabled={phase.kind === 'countdown'} style={[s.secondary, phase.kind === 'countdown' && s.off]}
          onPress={() => { dispatch({ type: 'cancel' }); store.requestRecalibration(); }}>
          <Text style={s.secondaryText}>다시 맞추기</Text>
        </Pressable>
      </View>
      <Text style={s.small}>카메라 영상은 화면에만 보이고 저장하거나 보내지 않아요.</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { gap: 14 },
  camera: { width: '100%', aspectRatio: BOX_ASPECT, borderRadius: 24, overflow: 'hidden', backgroundColor: C.text },
  bigWrap: { ...StyleSheet.absoluteFill,alignItems: 'center', justifyContent: 'center' },
  big: { color: C.accent, fontSize: 96, lineHeight: 110, fontWeight: '700', fontVariant: ['tabular-nums'], textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 8 },
  hud: { position: 'absolute', left: 12, bottom: 10, color: '#FFFFFF', fontSize: 10, fontVariant: ['tabular-nums'] },
  status: { color: C.text, fontSize: 15, fontWeight: '600' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  switch: { flexDirection: 'row', backgroundColor: C.card, borderRadius: 12, padding: 3 },
  switchItem: { paddingHorizontal: 12, minHeight: 36, borderRadius: 9, justifyContent: 'center' },
  switchOn: { backgroundColor: C.cardHi },
  switchText: { color: C.sub, fontSize: 12 },
  switchTextOn: { color: C.accent, fontWeight: '700' },
  count: { color: C.text, fontSize: 22, fontWeight: '600', fontVariant: ['tabular-nums'] },
  body: { color: C.sub, fontSize: 13, lineHeight: 20 },
  small: { color: C.dim, fontSize: 11, lineHeight: 17 },
  dim: { opacity: 0.45 },
  cue: { color: C.accent, fontSize: 15, lineHeight: 22, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 10 },
  primary: { flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#FFFFFF', fontWeight: '700' },
  secondary: { flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: C.cardHi, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: C.accent, fontWeight: '700' },
  off: { opacity: 0.4 },
  card: { backgroundColor: C.card, borderRadius: 20, padding: 20, gap: 10 },
  title: { color: C.text, fontSize: 16, fontWeight: '700' },
});
