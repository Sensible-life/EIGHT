import { Text } from '../ui/Typography';
import { displayMessage } from '../ui/displayMessage';
import Slider from '@react-native-community/slider';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, View } from 'react-native';
import WatchNative from '../../modules/watch-haptics';
import { StemPlayer } from '../audio/StemPlayer';
import { encodePattern, HapticSource, patternAtRate, selectPulses, transportAtRate } from '../haptics/pattern';
import { useLibrary } from '../state/LibraryProvider';
import { defaultExtras } from '../state/extras';
import { useDevice } from '../state/DeviceProvider';
import { C } from '../theme';

type Props = { player: StemPlayer; playing: boolean; rate: number; loopKey: string; transportBusy: boolean };
function WatchHapticsCard({ player, playing, rate, loopKey, transportBusy }: Props) {
  const { data, updateExtras } = useLibrary();
  const { connected, status: watchStatus, ensureWatch, reportWatchError } = useDevice();
  const { source, threshold, offset } = data.extras?.watch ?? defaultExtras().watch;
  const setSource = (source: HapticSource) => updateExtras(e => ({ ...e, watch: { ...e.watch, source } }));
  const setThreshold = (threshold: number) => updateExtras(e => ({ ...e, watch: { ...e.watch, threshold } }));
  const setOffset = (offset: number) => updateExtras(e => ({ ...e, watch: { ...e.watch, offset } }));
  const [enabled, setEnabled] = useState(false), [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Open Layer Lab on your watch.");
  const syncPending = useRef(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const alive = useRef(true), active = useRef(false), revision = useRef({ value: 0 });
  const hasBass = player.stems.includes('bass'), hasKick = player.stems.includes('drums');
  const pulses = useMemo(() => selectPulses(player.pulses('bass'), player.pulses('kick'), source, threshold), [player, source, threshold]);
  const enqueue = useCallback((action: () => Promise<unknown>) => {
    const next = queue.current.catch(() => {}).then(action);
    queue.current = next;
    return next;
  }, []);
  const fail = useCallback((error: unknown) => {
    active.current = false;
    reportWatchError(error);
    if (alive.current) { setEnabled(false); setStatus(`Connection needs attention · ${displayMessage(error)}`); }
  }, [reportWatchError]);
  const sync = useCallback(() => {
    if (!WatchNative || !active.current || syncPending.current) return;
    syncPending.current = true;
    const version = revision.current.value;
    void enqueue(async () => {
      if (!active.current || version !== revision.current.value) return;
      const state = { ...transportAtRate(player.transport, rate), sampledAtMs: WatchNative!.now(), offsetMs: offset };
      await WatchNative!.sync(JSON.stringify(state));
    }).finally(() => { syncPending.current = false; }).catch(fail);
  }, [enqueue, fail, player, offset, rate]);
  useEffect(() => {
    alive.current = true;
    const lifecycle = revision.current;
    return () => {
      alive.current = false; active.current = false; lifecycle.value++;
      void enqueue(async () => WatchNative?.stop()).catch(() => {});
    };
  }, [enqueue]);
  useEffect(() => {
    if (!enabled || !WatchNative) return;
    const version = ++revision.current.value;
    active.current = false;
    void enqueue(async () => {
      const pattern = patternAtRate(selectPulses(player.pulses('bass'), player.pulses('kick'), source, threshold), player.duration, rate);
      await WatchNative!.prepare(encodePattern(pattern.pulses, pattern.duration));
      if (alive.current && version === revision.current.value) { active.current = true; sync(); }
    }).catch(fail);
  }, [enabled, source, threshold, player, rate, enqueue, fail, sync]);
  useEffect(() => {
    if (!enabled) return;
    sync();
    const timer = setInterval(sync, 750);
    return () => clearInterval(timer);
  }, [enabled, playing, loopKey, transportBusy, sync]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') {
        active.current = false; revision.current.value++;
        setEnabled(false); setStatus("Reopen the app and connect your watch.");
        void enqueue(async () => WatchNative?.stop()).catch(() => {});
      }
    });
    return () => subscription.remove();
  }, [enqueue]);
  const disconnect = () => {
    active.current = false; revision.current.value++; setEnabled(false);
    void enqueue(async () => WatchNative?.stop()).catch(fail);
  };
  const connect = async () => {
    if (!WatchNative || busy) return;
    setBusy(true); setStatus("Checking watch connection and timing…");
    try {
      const watchReady = await ensureWatch();
      if (!alive.current) return;
      if (!watchReady) { setStatus('Watch unavailable. Check device settings.'); return; }
      setStatus('Watch connected.');
      setEnabled(true);
    } catch (error) { fail(error); }
    finally { if (alive.current) setBusy(false); }
  };
  return <View style={s.card}>
    <View style={s.header}><Text style={s.title}>Watch haptics</Text><Text style={s.badge}>GALAXY WATCH</Text></View>
    <Text style={s.note}>Vibrate to the bass or kick drum.</Text>
    <View style={s.row}>{(['bass', 'kick', 'both'] as const).map(kind => {
      const disabled = kind === 'bass' ? !hasBass : kind === 'kick' ? !hasKick : !hasBass || !hasKick;
      return <Pressable key={kind} accessibilityRole="button" aria-pressed={source === kind} disabled={disabled} onPress={() => setSource(kind)} style={[s.chip, source === kind && s.selected, disabled && s.disabled]}><Text style={s.text}>{kind === 'bass' ? "Bass" : kind === 'kick' ? "Kick drum" : "Both"}</Text></Pressable>;
    })}</View>
    <Text style={s.note}>Kick hits are estimated from low frequencies in the drum layer. Haptics work independently of mixer volume.</Text>
    <View style={s.header}><Text style={s.text}>Detection sensitivity</Text><Text style={s.note}>{threshold < 0.4 ? "Include subtle beats" : "Strong beats only"} · {pulses.length} times</Text></View>
    <Slider accessibilityLabel={"Vibration detection threshold"} minimumValue={0.1} maximumValue={0.8} step={0.05} value={threshold} onSlidingComplete={setThreshold} minimumTrackTintColor={C.accent} maximumTrackTintColor={C.line} thumbTintColor={C.accent} />
    <View style={s.header}><Text style={s.text}>Haptic timing offset</Text><Text style={s.text}>{offset > 0 ? '+' : ''}{offset}ms</Text></View>
    <Slider accessibilityLabel={"Watch haptic timing offset"} minimumValue={0} maximumValue={600} step={10} value={offset + 300} onSlidingComplete={value => setOffset(value - 300)} minimumTrackTintColor={C.accent} maximumTrackTintColor={C.line} thumbTintColor={C.accent} />
    <Text style={s.note}>Negative values move vibrations earlier; positive values delay them.</Text>
    {WatchNative ? <>
      <Text style={s.status}>{!connected ? `${watchStatus} Open Settings to reconnect.` : enabled ? status : 'Watch connected.'}</Text>
      <View style={s.row}><Pressable accessibilityRole="button" disabled={busy || !pulses.length || (!enabled && !connected)} onPress={() => enabled ? disconnect() : void connect()} style={[s.connect, (busy || !pulses.length || (!enabled && !connected)) && s.disabled]}><Text style={s.connectText}>{busy ? "Preparing…" : enabled ? "Turn haptics off" : "Turn haptics on"}</Text></Pressable>{enabled && <Pressable accessibilityRole="button" onPress={() => void enqueue(() => WatchNative!.test()).catch(fail)} style={s.chip}><Text style={s.text}>Test vibration</Text></Pressable>}</View>
      <Text style={s.note}>Keep both phone and watch apps open. Haptics stop automatically if disconnected.</Text>
    </> : <Text style={s.status}>{Platform.OS === 'android' ? "Install an Android development build with the watch module." : "Watch connection is available in the Android app."}</Text>}
    {!hasBass && !hasKick && <Text style={s.note}>Open a track with a bass or drum layer.</Text>}
  </View>;
}
export default memo(WatchHapticsCard);
const s = StyleSheet.create({
  card: { padding: 18, backgroundColor: C.card, borderRadius: 18, marginTop: 18, gap: 10, borderWidth: 1, borderColor: C.line }, header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, title: { color: C.text, fontSize: 15, fontFamily: 'SpaceGrotesk_600SemiBold' }, badge: { color: C.accent, fontSize: 8, letterSpacing: 1 }, note: { color: C.dim, fontSize: 10, lineHeight: 16 }, text: { color: C.sub, fontSize: 11 }, row: { flexDirection: 'row', gap: 8 }, chip: { flex: 1, padding: 11, alignItems: 'center', borderRadius: 10, borderWidth: 1, borderColor: C.line }, selected: { borderColor: C.accent, backgroundColor: C.cardHi }, disabled: { opacity: 0.4 }, connect: { flex: 2, backgroundColor: C.accent, borderRadius: 10, padding: 12, alignItems: 'center' }, connectText: { color: C.bg, fontSize: 11, fontFamily: 'SpaceGrotesk_600SemiBold' }, status: { color: C.sub, fontSize: 10, lineHeight: 17 },
});
