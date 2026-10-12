import Slider from '@react-native-community/slider';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';
import { analyzeTrace, parseTrace, sampleTrace, Trace, JOINTS } from '../motion/analyze';
import { useLibrary } from '../state/LibraryProvider';
import { readTextFile, saveMedia, deleteMedia } from '../storage/media';
import { C } from '../theme';
import { Button, Card, Empty, Heading, Page, Section, ui } from '../ui/Kit';
import VideoPreview from '../ui/VideoPreview';
import { confirmAction } from '../ui/confirm';
const labels = ['왼팔', '오른팔', '왼다리', '오른다리', '몸통'];
export default function Motion() {
  const { project: query, session: sessionId } = useLocalSearchParams<{ project?: string; session?: string }>();
  const { data, updateExtras } = useLibrary(); const [projectId, setProjectId] = useState(query ?? data.projects[0]?.id ?? '');
  const project = data.projects.find(p => p.id === projectId);
  const [trace, setTrace] = useState<Trace | null>(null), [bpm, setBpm] = useState(String(project?.job.tempo ?? 120)), [offset, setOffset] = useState(0), [video, setVideo] = useState<string>(), [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
  const records = (data.extras?.motions ?? []).filter(m => m.projectId === projectId);
  const result = trace && Number(bpm) >= 30 && Number(bpm) <= 300 ? analyzeTrace(trace, Number(bpm), offset) : null;
  const pickTrace = async () => { try { const r = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain'], copyToCacheDirectory: true }); if (!r.canceled) { setTrace(parseTrace(await readTextFile(r.assets[0].uri))); setStatus('좌표를 읽었어요. BPM과 시작 시간 보정을 확인해 주세요.'); } } catch (e) { setStatus(String(e)); } };
  const pickVideo = async (camera: boolean) => { if (busy) return; setBusy(true); try {
    if (camera) { const permission = await ImagePicker.requestCameraPermissionsAsync(); if (!permission.granted) { setStatus('영상 촬영을 위해 카메라 권한이 필요해요.'); return; } }
    const options = { mediaTypes: ['videos'] as ImagePicker.MediaType[], videoMaxDuration: 120, quality: .7 };
    const r = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (!r.canceled) { setVideo(r.assets[0].uri); setStatus('영상 선택 완료. 영상 자체의 자동 포즈 추정은 아직 연결되지 않았어요. 좌표 JSON 또는 샘플을 함께 선택해 주세요.'); }
  } catch (e) { setStatus(String(e)); } finally { setBusy(false); } };
  const save = async () => { if (!result || !trace || !project || busy) return; setBusy(true); let storedVideo: string | undefined; try { if (video) storedVideo = await saveMedia(video, '.mp4'); updateExtras(e => ({ ...e, motions: [{ id: `motion-${Date.now()}`, projectId, sessionId: data.sessions.some(s => s.id === sessionId && s.projectId === projectId) ? sessionId : undefined, name: project.job.name, createdAt: Date.now(), trace, result, video: storedVideo }, ...e.motions] })); setStatus('분석과 영상을 이 기기에 저장했어요.'); setTrace(null); setVideo(undefined); } catch (e) { if (storedVideo) await deleteMedia(storedVideo).catch(() => {}); setStatus(String(e)); } finally { setBusy(false); } };
  return <Page><Heading title="움직임 스튜디오" caption="BODY · SPACE · RHYTHM" /><Text style={ui.body}>실제 좌표 JSON을 분석하거나 샘플 동작으로 체험하세요. 영상은 프로젝트에 보관하고 다시 재생할 수 있어요.</Text>
    {!project ? <Empty title="음악 프로젝트가 필요해요" detail="체험 음악으로도 시작할 수 있어요." action="음악 선택" onPress={() => router.push('/new-session')} /> : <>
    <View style={{ gap: 8 }}>{data.projects.map(p => <Pressable accessibilityRole="button" accessibilityState={{ selected: p.id === projectId }} key={p.id} onPress={() => setProjectId(p.id)} style={[ui.card, { padding: 14, backgroundColor: projectId === p.id ? C.cardHi : C.card }]}><Text style={ui.body}>{p.job.name}</Text></Pressable>)}</View>
    <Card><Text style={ui.h3}>1. 영상 준비 · 선택 사항</Text><Button title="영상 가져오기" onPress={() => void pickVideo(false)} disabled={busy} secondary /><Button title="영상 촬영" onPress={() => void pickVideo(true)} disabled={busy || Platform.OS === 'web'} secondary />{video && <VideoPreview uri={video} />}<Text style={ui.small}>촬영은 네이티브 앱에서 지원해요. 영상만으로 분석 결과를 만들지는 않아요.</Text></Card>
    <Card><Text style={ui.h3}>2. 동작 좌표 선택</Text><Button title="포즈 좌표 JSON 가져오기" onPress={() => void pickTrace()} secondary /><View style={{ gap: 8 }}>{[['balanced', '균형 동작'], ['arms', '팔 중심 동작'], ['travel', '공간 이동']].map(([kind, title]) => <Button key={kind} title={`${title} · 샘플`} secondary onPress={() => { setTrace(sampleTrace(kind as 'balanced' | 'arms' | 'travel')); setStatus('샘플 좌표로 계산한 체험 결과입니다. 실제 촬영 분석이 아니에요.'); }} />)}</View></Card>
    {trace && <Card><Text style={ui.pill}>{trace.source === 'sample' ? 'SAMPLE · 더미 좌표 기반' : 'IMPORTED · 가져온 좌표 기반'}</Text><Text style={ui.h3}>3. 음악과 시간 맞추기</Text><TextInput style={ui.input} accessibilityLabel="동작 분석 BPM" keyboardType="numeric" value={bpm} onChangeText={setBpm} /><Text style={ui.body}>BPM 30~300 · 영상 → 음악 시간 보정 {offset.toFixed(2)}초</Text><Slider accessibilityLabel="동작 시간 보정" minimumValue={0} maximumValue={20} value={offset + 10} step={.05} onValueChange={v => setOffset(v - 10)} minimumTrackTintColor={C.accent} thumbTintColor={C.accent} /><Text style={ui.small}>양수는 좌표 시간에 더해 음악의 시작과 맞춥니다. 일치도는 일정 BPM 격자와 ±120ms 안의 동작 속도 피크 비율이에요.</Text></Card>}
    {result && <Card><Text style={ui.h3}>동작 분석 결과</Text>{JOINTS.map((j, i) => <View key={j} style={ui.between}><Text style={ui.body}>{labels[i]}</Text><Text style={ui.link}>{Math.round(result.body[j] * 100)}%</Text></View>)}<Text style={ui.body}>반복 추정 {result.repeats}회 · 주기 {result.period?.toFixed(2) ?? '—'}초</Text><Text style={ui.body}>비트 격자 일치 {result.beatMatch === null ? '—' : `${Math.round(result.beatMatch * 100)}%`} · 유효 좌표 {Math.round(result.coverage * 100)}%</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>{result.space.map((v, i) => <View key={i} style={{ width: '31%', height: 45, backgroundColor: `rgba(178,11,194,${.08 + v * .8})`, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}><Text style={ui.small}>{Math.round(v * 100)}%</Text></View>)}</View><Button title="분석 기록 저장" onPress={() => void save()} disabled={busy} /></Card>}
    {!!status && <Text accessibilityLiveRegion="polite" style={ui.body}>{status}</Text>}
    <Section title={`저장된 분석 · ${records.length}`} />{records.map(m => <Card key={m.id}><Text style={ui.pill}>{m.result.source === 'sample' ? '샘플 데이터' : '가져온 좌표'}</Text><Text style={ui.h3}>{new Date(m.createdAt).toLocaleString('ko-KR')}</Text><Text style={ui.body}>반복 {m.result.repeats}회 · 비트 {m.result.beatMatch === null ? '—' : `${Math.round(m.result.beatMatch * 100)}%`}</Text>{m.video && <VideoPreview uri={m.video} />}<Button title="좌표 다시 분석" secondary onPress={() => { setTrace(m.trace); setBpm(String(m.result.bpm)); setOffset(m.result.offset); setVideo(undefined); }} /><Button title="분석 기록 삭제" secondary onPress={() => confirmAction('분석 삭제', '이 분석에 연결된 영상도 기기에서 삭제됩니다.', () => { updateExtras(e => ({ ...e, motions: e.motions.filter(x => x.id !== m.id) })); if (m.video) void deleteMedia(m.video).catch(e => setStatus(String(e))); })} /></Card>)}
    </>}
  </Page>;
}
