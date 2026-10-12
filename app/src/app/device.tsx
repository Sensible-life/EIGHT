import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import WatchNative from '../../modules/watch-haptics';
import { useLibrary } from '../state/LibraryProvider';
import { C } from '../theme';
import { Button, Card, Empty, Heading, Icon, Page, ui } from '../ui/Kit';
export default function Device() {
  const { project: projectId, resume } = useLocalSearchParams<{ project?: string; resume?: string }>();
  const { data, pending, start } = useLibrary(); const p = data.projects.find(p => p.id === (projectId ?? pending));
  const [status, setStatus] = useState('워치 앱에서 Layer Lab을 열어주세요.'), [busy, setBusy] = useState(false), [connected, setConnected] = useState(false);
  const connect = async () => { if (!WatchNative || busy) return; setBusy(true); setConnected(false); try { const watch = await WatchNative.connect(); setStatus(`${watch.name} · 응답 ${Math.round(watch.roundTripMs)}ms`); setConnected(true); } catch (e) { setStatus(`연결을 확인해 주세요. ${String(e)}`); } finally { setBusy(false); } };
  const test = async () => { try { await WatchNative?.test(); setStatus('테스트 진동을 보냈어요. 손목에서 확인해 주세요.'); } catch (e) { setConnected(false); setStatus(String(e)); } };
  if (!p) return <Page><Empty title="먼저 음악을 선택해 주세요" detail="음악을 고른 뒤 워치를 연결할 수 있어요." action="음악 선택" onPress={() => router.replace('/new-session')} /></Page>;
  return <Page><Heading title="리듬을 손목으로 느껴요" caption="02 / DEVICE CONNECTION" /><Card><View style={ui.row}><View style={ui.iconCircle}><Icon name="musical-notes-outline" color={C.accent} /></View><View style={{ flex: 1 }}><Text style={ui.h3} numberOfLines={1}>{p.job.name}</Text><Text style={ui.small}>{p.job.stems?.length ?? 0}개 레이어 준비 완료</Text></View><Icon name="checkmark-circle" color={C.ok} /></View></Card>
    <Card style={{ alignItems: 'center', paddingVertical: 32 }}><View style={{ width: 100, height: 140, borderRadius: 34, backgroundColor: C.cardHi, alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}><Icon name="watch-outline" size={92} color={C.accent} /></View><Text style={ui.h2}>Galaxy Watch</Text><Text style={ui.body}>베이스와 킥의 비트를 진동으로 전달해요.</Text><Text style={[ui.small, { textAlign: 'center', marginVertical: 8 }]}>{WatchNative ? status : '워치 연결은 Android 개발 빌드에서 사용할 수 있어요.'}</Text><View style={{ width: '100%', gap: 10 }}><Button title={busy ? '워치를 찾는 중…' : connected ? '다시 연결 확인' : '워치 연결 확인'} onPress={connect} disabled={!WatchNative || busy} icon="bluetooth" />{connected && <Button title="테스트 진동 보내기" onPress={test} secondary />}</View></Card>
    <Text style={ui.body}>폰과 워치를 Galaxy Wearable로 연결해 주세요. 세션의 ‘손목으로 듣는 비트’에서 진동을 켜고 감도와 타이밍을 조절할 수 있어요.</Text>
    <Button title={connected ? '세션 시작하기' : '워치 없이 시작하기'} icon="play" onPress={() => { const id = start(p.id, resume); router.replace({ pathname: '/session', params: { id } }); }} secondary={!connected} /><Text style={[ui.small, { textAlign: 'center' }]}>현재 워치 진동은 폰과 워치 앱이 열려 있을 때 동작해요.</Text>
  </Page>;
}
