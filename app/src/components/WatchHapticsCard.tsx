import Slider from '@react-native-community/slider';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import WatchNative from '../../modules/watch-haptics';
import { StemPlayer } from '../audio/StemPlayer';
import { encodePattern, HapticSource, selectPulses } from '../haptics/pattern';
import { useLibrary } from '../state/LibraryProvider';
import { defaultExtras } from '../state/extras';
import { C } from '../theme';

type Props = { player: StemPlayer; playing: boolean; loopKey: string; transportBusy: boolean };
function WatchHapticsCard({ player, playing, loopKey, transportBusy }: Props) {
  const { data, updateExtras } = useLibrary();
  const { source, threshold, offset } = data.extras?.watch ?? defaultExtras().watch;
  const setSource = (source: HapticSource) => updateExtras(e => ({ ...e, watch: { ...e.watch, source } }));
  const setThreshold = (threshold: number) => updateExtras(e => ({ ...e, watch: { ...e.watch, threshold } }));
  const setOffset = (offset: number) => updateExtras(e => ({ ...e, watch: { ...e.watch, offset } }));
  const [enabled, setEnabled] = useState(false), [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('워치에서 Layer Lab 앱을 열어 주세요.');
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
    if (alive.current) { setEnabled(false); setStatus(`연결 확인 필요 · ${String(error)}`); }
  }, []);
  const sync = useCallback(() => {
    if (!WatchNative || !active.current || syncPending.current) return;
    syncPending.current = true;
    const version = revision.current.value;
    void enqueue(async () => {
      if (!active.current || version !== revision.current.value) return;
      const state = { ...player.transport, sampledAtMs: WatchNative!.now(), offsetMs: offset };
      await WatchNative!.sync(JSON.stringify(state));
    }).finally(() => { syncPending.current = false; }).catch(fail);
  }, [enqueue, fail, player, offset]);
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
      await WatchNative!.prepare(encodePattern(selectPulses(player.pulses('bass'), player.pulses('kick'), source, threshold), player.duration));
      if (alive.current && version === revision.current.value) { active.current = true; sync(); }
    }).catch(fail);
  }, [enabled, source, threshold, player, enqueue, fail, sync]);
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
        setEnabled(false); setStatus('앱을 다시 열고 워치 연결을 눌러 주세요.');
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
    setBusy(true); setStatus('워치 연결과 시간 차이를 확인 중…');
    try {
      const watch = await enqueue(() => WatchNative!.connect()) as { name: string; roundTripMs: number };
      if (!alive.current) return;
      setStatus(`${watch.name} 연결됨 · 왕복 ${Math.round(watch.roundTripMs)}ms`);
      setEnabled(true);
    } catch (error) { fail(error); }
    finally { if (alive.current) setBusy(false); }
  };
  return <View style={s.card}>
    <View style={s.header}><Text style={s.title}>손목으로 듣는 비트</Text><Text style={s.badge}>GALAXY WATCH</Text></View>
    <Text style={s.note}>베이스의 리듬이나 킥에 맞춰 짧게 진동해요.</Text>
    <View style={s.row}>{(['bass', 'kick', 'both'] as const).map(kind => {
      const disabled = kind === 'bass' ? !hasBass : kind === 'kick' ? !hasKick : !hasBass || !hasKick;
      return <Pressable key={kind} accessibilityRole="button" aria-pressed={source === kind} disabled={disabled} onPress={() => setSource(kind)} style={[s.chip, source === kind && s.selected, disabled && s.disabled]}><Text style={s.text}>{kind === 'bass' ? '베이스' : kind === 'kick' ? '킥드럼' : '둘 다'}</Text></Pressable>;
    })}</View>
    <Text style={s.note}>킥은 드럼 레이어의 저음 타격으로 추정합니다. 진동은 믹서 볼륨과 독립적으로 동작해요.</Text>
    <View style={s.header}><Text style={s.text}>감지 범위</Text><Text style={s.note}>{threshold < 0.4 ? '작은 비트까지' : '강한 비트만'} · {pulses.length}회</Text></View>
    <Slider accessibilityLabel="진동 감지 기준" minimumValue={0.1} maximumValue={0.8} step={0.05} value={threshold} onSlidingComplete={setThreshold} minimumTrackTintColor={C.accent} maximumTrackTintColor={C.line} thumbTintColor={C.accent} />
    <View style={s.header}><Text style={s.text}>진동 싱크 보정</Text><Text style={s.text}>{offset > 0 ? '+' : ''}{offset}ms</Text></View>
    <Slider accessibilityLabel="워치 진동 싱크 보정" minimumValue={0} maximumValue={600} step={10} value={offset + 300} onSlidingComplete={value => setOffset(value - 300)} minimumTrackTintColor={C.accent} maximumTrackTintColor={C.line} thumbTintColor={C.accent} />
    <Text style={s.note}>음수는 진동을 앞당기고, 양수는 늦춰요.</Text>
    {WatchNative ? <>
      <Text style={s.status}>{status}</Text>
      <View style={s.row}><Pressable accessibilityRole="button" disabled={busy || !pulses.length} onPress={() => enabled ? disconnect() : void connect()} style={[s.connect, (busy || !pulses.length) && s.disabled]}><Text style={s.connectText}>{busy ? '연결 중…' : enabled ? '워치 진동 끄기' : '워치 연결하고 진동 켜기'}</Text></Pressable>{enabled && <Pressable accessibilityRole="button" onPress={() => void enqueue(() => WatchNative!.test()).catch(fail)} style={s.chip}><Text style={s.text}>진동 테스트</Text></Pressable>}</View>
      <Text style={s.note}>폰과 워치 앱을 열어 둔 상태에서 사용하세요. 연결이 끊기면 워치 진동은 자동 중지됩니다.</Text>
    </> : <Text style={s.status}>{Platform.OS === 'android' ? '워치 연결 모듈이 포함된 Android 개발 빌드를 설치해 주세요.' : '워치 연결은 Android 앱에서 사용할 수 있어요.'}</Text>}
    {!hasBass && !hasKick && <Text style={s.note}>베이스 또는 드럼 레이어가 있는 곡을 열어 주세요.</Text>}
  </View>;
}
export default memo(WatchHapticsCard);
const s = StyleSheet.create({
  card: { padding: 18, backgroundColor: C.card, borderRadius: 18, marginTop: 18, gap: 10, borderWidth: 1, borderColor: C.line }, header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, title: { color: C.text, fontSize: 15, fontWeight: '600' }, badge: { color: C.accent, fontSize: 8, letterSpacing: 1 }, note: { color: C.dim, fontSize: 10, lineHeight: 16 }, text: { color: C.sub, fontSize: 11 }, row: { flexDirection: 'row', gap: 8 }, chip: { flex: 1, padding: 11, alignItems: 'center', borderRadius: 10, borderWidth: 1, borderColor: C.line }, selected: { borderColor: C.accent, backgroundColor: C.cardHi }, disabled: { opacity: 0.4 }, connect: { flex: 2, backgroundColor: C.accent, borderRadius: 10, padding: 12, alignItems: 'center' }, connectText: { color: C.bg, fontSize: 11, fontWeight: '600' }, status: { color: C.sub, fontSize: 10, lineHeight: 17 },
});
