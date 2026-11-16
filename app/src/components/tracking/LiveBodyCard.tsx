import { Text } from '../../ui/Typography';
import { displayMessage } from '../../ui/displayMessage';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { AppState, Linking, Pressable, StyleSheet, View } from 'react-native';
import PoseCameraView from '../../../modules/pose-camera';
import type { MotionResult } from '../../motion/analyze';
import type { Session } from '../../state/model';
import { extremes, fromSegments, fromStudio, liveClock, type BodyShares } from '../../tracking/bodyMap';
import { DEFAULT_CONFIG, detectorJson } from '../../tracking/config';
import { trackingInsights } from '../../tracking/insights';
import { SEGMENT_LABELS } from '../../tracking/phrases';
import { LiveTrackingStore, type TrackingView } from '../../tracking/store';
import type { WindowName } from '../../tracking/types';
import { C, fmtTime } from '../../theme';
import { Card, ui } from '../../ui/Kit';
import BodyHeatmap from './BodyHeatmap';
import SkeletonOverlay from './SkeletonOverlay';

const DETECTOR = detectorJson();
const PREVIEW_ASPECT = 3 / 4; // upright 4:3 frame, same as the camera tab
const NOW_MS = 1000 * DEFAULT_CONFIG.aggregate.windows['8count_s']; // "지금" = the last 4 s, rolling
const WINDOWS: [WindowName, string][] = [['8count', "Last 4 seconds"], ['recent', "Last 30 seconds"], ['session', "Since starting"]];

type Props = { sessions: Session[]; latest?: MotionResult };

/**
 * Analysis tab · Body card. Off: the body heatmap from saved camera sessions (else the motion studio's last result).
 * Live: the front camera fills the same heatmap with the share of movement per part, updated ~15 times a second.
 * The live view is a mirror, not a recording: nothing is saved, and video never leaves the camera module.
 */
export default function LiveBodyCard({ sessions, latest }: Props) {
  const [live, setLive] = useState(false);
  const stop = useCallback(() => setLive(false), []);
  const saved = savedShares(sessions, latest);
  return (
    <Card>
      <View style={ui.between}>
        <Text style={ui.h3}>Movement balance</Text>
        <Text style={ui.pill}>{live ? "Live camera" : saved.pill}</Text>
      </View>
      {live ? <LiveView onStop={stop} /> : (
        <>
          <BodyHeatmap shares={saved.shares} />
          <Highlight shares={saved.shares} />
          <Text style={ui.body}>{saved.note}</Text>
          {PoseCameraView
            ? <Pressable accessibilityRole="button" onPress={() => setLive(true)} style={s.primary}><Text style={s.primaryText}>View live camera</Text></Pressable>
            : <Text style={ui.small}>Live camera is available in the Android app.</Text>}
        </>
      )}
    </Card>
  );
}

const EMPTY: BodyShares = { head: 0, torso: 0, arm_l: 0, arm_r: 0, leg_l: 0, leg_r: 0 };

function savedShares(sessions: Session[], latest?: MotionResult): { shares: BodyShares; pill: string; note: string } {
  const insight = trackingInsights(sessions.map(x => x.tracking));
  if (insight) return {
    shares: fromSegments(insight.segments),
    pill: `Camera history · ${insight.sessions} sessions`,
    note: `Share of movement by body part during ${fmtTime(insight.trackedMs / 1000)} of music playback with the session camera.`,
  };
  if (latest) return {
    shares: fromStudio(latest.body),
    pill: latest.source === 'sample' ? "Latest sample analysis" : "Latest pose analysis",
    note: "Pose analysis from Motion Studio. The head is not shown because the data does not include it.",
  };
  return { shares: EMPTY, pill: "No data", note: "Turn on live camera or use the camera during a session." };
}

function Highlight({ shares, dim = false }: { shares: BodyShares; dim?: boolean }) {
  const e = extremes(shares);
  if (!e) return null;
  return <Text style={[ui.body, dim && s.dim]}>Most active <Text style={s.strong}>{SEGMENT_LABELS[e.most]}</Text> · least active <Text style={s.strong}>{SEGMENT_LABELS[e.least]}</Text></Text>;
}

function statusText(view: TrackingView): string {
  if (view.error) return view.error;
  const state = view.status?.state;
  if (!state || state === 'waiting') return "Stand in front of the camera with your full body visible.";
  if (state === 'calibrating') return `Hold still for ${DEFAULT_CONFIG.calibration.duration_s} sec · ${Math.round((view.status?.progress ?? 0) * 100)}%`;
  if (!view.usage['8count']?.tracking_ok) return "Body not fully visible · adjust your position";
  return "Live tracking";
}

/** Mounted only while live: owns its own tracking store, so turning it off throws everything away. */
function LiveView({ onStop }: { onStop: () => void }) {
  const [store] = useState(() => {
    const st = new LiveTrackingStore(DEFAULT_CONFIG, { perfNowMs: () => performance.now() });
    st.setPlan({ kind: 'rolling', ms: NOW_MS });
    st.setMusicSource(liveClock(Date.now()));
    return st;
  });
  const view = useSyncExternalStore(store.subscribe, store.getView);
  const [permission, setPermission] = useState<'asking' | 'granted' | 'denied'>('asking');
  const [windowName, setWindowName] = useState<WindowName>('8count');

  useEffect(() => {
    let alive = true;
    const check = (ask: boolean) => (ask ? ImagePicker.requestCameraPermissionsAsync() : ImagePicker.getCameraPermissionsAsync())
      .then(r => { if (alive) setPermission(r.granted ? 'granted' : 'denied'); })
      .catch(() => { if (alive) setPermission('denied'); });
    void check(true);
    // The camera itself stops with the app (CameraX follows the activity); here we only re-check the permission
    // when coming back, e.g. from the system settings. Not closing on 'background': the permission dialog pauses the app too.
    const sub = AppState.addEventListener('change', state => { if (state === 'active') void check(false); });
    return () => { alive = false; sub.remove(); };
  }, []);

  if (!PoseCameraView) return null;
  if (permission === 'denied') return (
    <View style={{ gap: 10 }}>
      <Text style={ui.body}>Camera access is required for motion tracking. Live video is not saved or sent.</Text>
      <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings()} style={s.secondary}><Text style={s.secondaryText}>Open settings</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={onStop} style={s.secondary}><Text style={s.secondaryText}>Close</Text></Pressable>
    </View>
  );

  const usage = view.usage[windowName];
  const tracking = view.status?.state === 'tracking';
  const dim = !tracking || !view.usage['8count']?.tracking_ok;
  const shares = usage ? fromSegments(usage.segments) : EMPTY;
  return (
    <View style={{ gap: 12 }}>
      <View style={s.switch}>
        {WINDOWS.map(([w, title]) => (
          <Pressable key={w} accessibilityRole="button" accessibilityState={{ selected: windowName === w }} onPress={() => setWindowName(w)} style={[s.switchItem, windowName === w && s.switchOn]}>
            <Text style={[s.switchText, windowName === w && s.switchTextOn]}>{title}</Text>
          </Pressable>
        ))}
      </View>
      <View style={s.liveRow}>
        <View style={s.figure}><BodyHeatmap shares={shares} underused={tracking ? usage?.underused ?? [] : []} dim={dim} /></View>
        <View style={s.preview}>
          {permission === 'granted' && (
            <PoseCameraView style={StyleSheet.absoluteFill} active model="lite" detectorJson={DETECTOR}
              onPose={e => store.handlePose(e.nativeEvent)} onEngine={e => store.handleEngine(e.nativeEvent)} onError={e => store.handleError(displayMessage(e.nativeEvent.message))} />
          )}
          <SkeletonOverlay pose={view.pose} shares={view.usage.session?.segments ?? null} underused={[]} boxAspect={PREVIEW_ASPECT} visibility={DEFAULT_CONFIG.pose.visibility_threshold} />
        </View>
      </View>
      <Text style={s.status} accessibilityLiveRegion="polite">{statusText(view)}</Text>
      {tracking && <Highlight shares={shares} dim={dim} />}
      <Text style={ui.small}>
        {view.perf ? `${view.perf.pose_fps} fps · detection ${Math.round(view.perf.detect_rate * 100)}% · ` : ''}
        Share of movement by body part, based on speed and joint angles. Hidden body parts are excluded. Live viewing is not saved.
      </Text>
      <Pressable accessibilityRole="button" onPress={onStop} style={s.secondary}><Text style={s.secondaryText}>Turn off live view</Text></Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  primary: { minHeight: 48, borderRadius: 14, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#FFFFFF', fontFamily: 'SpaceGrotesk_600SemiBold' },
  secondary: { minHeight: 44, borderRadius: 14, backgroundColor: C.cardHi, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: C.accent, fontFamily: 'SpaceGrotesk_600SemiBold' },
  switch: { flexDirection: 'row', backgroundColor: C.bg, borderRadius: 12, padding: 3 },
  switchItem: { flex: 1, minHeight: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  switchOn: { backgroundColor: C.card },
  switchText: { color: C.sub, fontSize: 12 },
  switchTextOn: { color: C.accent, fontFamily: 'SpaceGrotesk_600SemiBold' },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  figure: { flex: 1 },
  preview: { width: 108, aspectRatio: PREVIEW_ASPECT, borderRadius: 14, overflow: 'hidden', backgroundColor: C.text },
  status: { color: C.text, fontSize: 14, fontFamily: 'SpaceGrotesk_600SemiBold' },
  strong: { color: C.accent, fontFamily: 'SpaceGrotesk_600SemiBold' },
  dim: { opacity: 0.45 },
});
