import { Text, TextInput } from '../ui/Typography';
import { displayMessage } from '../ui/displayMessage';
import Slider from '@react-native-community/slider';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { analyzeTrace, parseTrace, sampleTrace, Trace, JOINTS } from '../motion/analyze';
import { useLibrary } from '../state/LibraryProvider';
import { readTextFile, saveMedia, deleteMedia } from '../storage/media';
import { C } from '../theme';
import { Button, Card, Disclosure, Empty, Page, ui } from '../ui/Kit';
import VideoPreview from '../ui/VideoPreview';
import { confirmAction } from '../ui/confirm';
import { SectionTitle } from '../ui/ScreenParts';
const labels = ["Left arm", "Right arm", "Left leg", "Right leg", "Torso"];
export default function Motion() {
  const { project: query, session: sessionId } = useLocalSearchParams<{ project?: string; session?: string }>();
  const { data, updateExtras } = useLibrary(); const [projectId, setProjectId] = useState(query ?? data.projects[0]?.id ?? '');
  const project = data.projects.find(p => p.id === projectId);
  const [trace, setTrace] = useState<Trace | null>(null), [bpm, setBpm] = useState(String(project?.job.tempo ?? 120)), [offset, setOffset] = useState(0), [video, setVideo] = useState<string>(), [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
  const records = (data.extras?.motions ?? []).filter(m => m.projectId === projectId);
  const result = trace && Number(bpm) >= 30 && Number(bpm) <= 300 ? analyzeTrace(trace, Number(bpm), offset) : null;
  const pickTrace = async () => { try { const r = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain'], copyToCacheDirectory: true }); if (!r.canceled) { setTrace(parseTrace(await readTextFile(r.assets[0].uri))); setStatus("Pose data loaded. Check the BPM and time offset."); } } catch (e) { setStatus(displayMessage(e)); } };
  const pickVideo = async (camera: boolean) => { if (busy) return; setBusy(true); try {
    if (camera) { const permission = await ImagePicker.requestCameraPermissionsAsync(); if (!permission.granted) { setStatus("Camera permission is required to record video."); return; } }
    const options = { mediaTypes: ['videos'] as ImagePicker.MediaType[], videoMaxDuration: 120, quality: .7 };
    const r = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (!r.canceled) { setVideo(r.assets[0].uri); setStatus("Video selected. Automatic pose estimation is not available yet. Select pose data or a sample as well."); }
  } catch (e) { setStatus(displayMessage(e)); } finally { setBusy(false); } };
  const save = async () => { if (!result || !trace || !project || busy) return; setBusy(true); let storedVideo: string | undefined; try { if (video) storedVideo = await saveMedia(video, '.mp4'); updateExtras(e => ({ ...e, motions: [{ id: `motion-${Date.now()}`, projectId, sessionId: data.sessions.some(s => s.id === sessionId && s.projectId === projectId) ? sessionId : undefined, name: project.job.name, createdAt: Date.now(), trace, result, video: storedVideo }, ...e.motions] })); setStatus("Analysis and video saved to this device."); setTrace(null); setVideo(undefined); } catch (e) { if (storedVideo) await deleteMedia(storedVideo).catch(() => {}); setStatus(displayMessage(e)); } finally { setBusy(false); } };
  return <Page><SectionTitle title="Motion analysis" detail="Import pose data or try a sample." />
    {!project ? <Empty title={"A music project is required"} detail={"You can also start with demo music."} action={"Choose music"} onPress={() => router.push('/new-session')} /> : <>
    <Disclosure title={"Project to analyze"} detail={project.job.name} icon="musical-notes-outline"><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{data.projects.map(p => <Pressable accessibilityRole="button" accessibilityState={{ selected: p.id === projectId }} key={p.id} onPress={() => setProjectId(p.id)} style={{ flexGrow: 1, minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 12, backgroundColor: projectId === p.id ? C.cardHi : C.card }}><Text style={ui.body}>{p.job.name}</Text></Pressable>)}</View></Disclosure>
    <Disclosure title={"Video · optional"} detail={video ? "Video selected" : "Import or record"} icon="videocam-outline"><Button title={"Import video"} onPress={() => void pickVideo(false)} disabled={busy} secondary /><Button title={"Record video"} onPress={() => void pickVideo(true)} disabled={busy || Platform.OS === 'web'} secondary />{video && <VideoPreview uri={video} />}<Text style={ui.small}>Recording is available in the native app. Video alone does not produce analysis.</Text></Disclosure>
    <Disclosure title="Pose data" detail={trace ? (trace.source === 'sample' ? 'Sample selected' : 'Pose data loaded') : 'Import JSON or try a sample'} icon="body-outline" initiallyOpen><Button title={"Import pose JSON"} onPress={() => void pickTrace()} secondary /><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{[['balanced', "Balanced movement"], ['arms', "Arm movement"], ['travel', "Moving through space"]].map(([kind, title]) => <View key={kind} style={{ flexGrow: 1 }}><Button title={`${title} · Sample`} secondary onPress={() => { setTrace(sampleTrace(kind as 'balanced' | 'arms' | 'travel')); setStatus("Results are calculated from sample data, not recorded video."); }} /></View>)}</View></Disclosure>
    {trace && <Card><Text style={ui.pill}>{trace.source === 'sample' ? "SAMPLE · simulated pose data" : "IMPORTED · pose data"}</Text><Text style={ui.h3}>Sync with music</Text><TextInput style={ui.input} accessibilityLabel={"Motion analysis BPM"} keyboardType="numeric" value={bpm} onChangeText={setBpm} /><Text style={ui.body}>BPM 30–300 · video-to-music offset {offset.toFixed(2)} sec</Text><Slider accessibilityLabel={"Motion time offset"} minimumValue={0} maximumValue={20} value={offset + 10} step={.05} onValueChange={v => setOffset(v - 10)} minimumTrackTintColor={C.accent} thumbTintColor={C.accent} /><Text style={ui.small}>Positive values shift pose data later. Beat match is the share of movement peaks within ±120 ms of a constant BPM grid.</Text></Card>}
    {result && <Card><Text style={ui.h3}>Motion analysis results</Text>{JOINTS.map((j, i) => <View key={j} style={ui.between}><Text style={ui.body}>{labels[i]}</Text><Text style={ui.link}>{Math.round(result.body[j] * 100)}%</Text></View>)}<Text style={ui.body}>Estimated repetitions: {result.repeats} · period {result.period?.toFixed(2) ?? '—'} sec</Text><Text style={ui.body}>Beat match {result.beatMatch === null ? '—' : `${Math.round(result.beatMatch * 100)}%`} · valid pose data {Math.round(result.coverage * 100)}%</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>{result.space.map((v, i) => <View key={i} style={{ width: '31%', height: 45, backgroundColor: `rgba(178,11,194,${.08 + v * .8})`, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}><Text style={ui.small}>{Math.round(v * 100)}%</Text></View>)}</View><Button title={"Save analysis"} onPress={() => void save()} disabled={busy} /></Card>}
    {!!status && <Text accessibilityLiveRegion="polite" style={ui.body}>{status}</Text>}
    <Disclosure title={`Saved analyses · ${records.length}`} detail={"Analysis history and videos"} icon="archive-outline">{records.map(m => <Disclosure key={m.id} title={new Date(m.createdAt).toLocaleString('en-US')} detail={`Repetitions: ${m.result.repeats} · beat match: ${m.result.beatMatch === null ? '—' : `${Math.round(m.result.beatMatch * 100)}%`}`}><Text style={ui.pill}>{m.result.source === 'sample' ? "Sample data" : "Imported pose data"}</Text>{m.video && <VideoPreview uri={m.video} />}<Button title={"Reanalyze pose data"} secondary onPress={() => { setTrace(m.trace); setBpm(String(m.result.bpm)); setOffset(m.result.offset); setVideo(undefined); }} /><Button title={"Delete analysis"} secondary onPress={() => confirmAction("Delete analysis", "The video associated with this analysis will also be deleted from this device.", () => { updateExtras(e => ({ ...e, motions: e.motions.filter(x => x.id !== m.id) })); if (m.video) void deleteMedia(m.video).catch(e => setStatus(displayMessage(e))); })} /></Disclosure>)}{records.length === 0 && <Text style={ui.small}>No saved analyses yet.</Text>}</Disclosure>
    </>}
  </Page>;
}
