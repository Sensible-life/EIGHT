import { router, useLocalSearchParams } from 'expo-router';
import { api } from '../api';
import { useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import { saveMedia, deleteMedia } from '../storage/media';
import { confirmAction } from '../ui/confirm';
import { Text, TextInput, View } from 'react-native';
import { useLibrary } from '../state/LibraryProvider';
import { fmtTime, STEM_LABELS } from '../theme';
import { Button, Card, Empty, Heading, MotionArt, Page, Section, ui } from '../ui/Kit';
export default function Project() {
  const { id } = useLocalSearchParams<{ id: string }>(); const { data, choose, toggleSaved, patchProject, removeProject, removeSession, cacheProject, clearCache } = useLibrary();
  const project = data.projects.find(p => p.id === id); const sessions = data.sessions.filter(s => s.projectId === id);
  const [name, setName] = useState(''), [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (e) { setStatus(String(e)); } finally { setBusy(false); } };
  if (!project) return <Page><Empty title="프로젝트를 찾을 수 없어요" detail="워크스페이스에서 다른 음악을 선택해 주세요." action="워크스페이스" onPress={() => router.replace('/workspace')} /></Page>;
  return <Page><Heading title={project.job.name.replace(/\.[^.]+$/, '')} caption="MY PROJECT" /><Card style={{ backgroundColor: '#F1DCF5' }}><MotionArt /><View style={ui.between}><Text style={ui.pill}>{project.job.stems?.length ?? 0} LAYERS</Text><Text style={ui.small}>{project.job.tempo ? `${Math.round(project.job.tempo)} BPM` : '나만의 사운드'}</Text></View></Card>
    <Button title="이 음악으로 연습하기" icon="play" onPress={() => { choose(project.id); router.push({ pathname: '/device', params: { project: project.id } }); }} /><Button title={project.saved ? '저장됨 · 저장 해제' : '프로젝트 저장하기'} icon="bookmark-outline" secondary onPress={() => toggleSaved(project.id)} />
    <Button title="영상 · 동작 분석 스튜디오" secondary onPress={() => router.push({ pathname: '/motion', params: { project: project.id } })} />
    <Card><Text style={ui.h3}>프로젝트 관리</Text><TextInput style={ui.input} accessibilityLabel="프로젝트 이름" placeholder={project.job.name} value={name} onChangeText={setName} maxLength={120} /><Button title="이름 변경" secondary disabled={!name.trim()} onPress={() => { patchProject(id, { job: { ...project.job, name: name.trim() } }); setName(''); setStatus('이름을 변경했어요.'); }} />
    {project.job.config.model !== 'imported' && <Button title={project.cached ? '다운로드 해제' : '오프라인 보관'} disabled={busy} secondary onPress={() => { if (project.cached) confirmAction('다운로드 해제', '원본 서버 연결이 다시 필요합니다.', () => void run(async () => { await clearCache(id); setStatus('기기 다운로드를 해제했어요.'); })); else void run(async () => { await cacheProject(id, (done, total) => setStatus(`파일 저장 중 ${done}/${total}`)); setStatus('오프라인 보관 완료'); }); }} />}
    {!['demo', 'imported'].includes(project.job.config.model) && <Button title="현재 서버에서 원본 다시 연결" secondary disabled={busy} onPress={() => void run(async () => { const fresh = await api.job(data.server, project.job.id); if (fresh.status !== 'done' || !fresh.files || !Object.keys(fresh.files).length) throw new Error('현재 서버에서 완료된 작업을 찾지 못했어요.'); patchProject(id, { server: data.server, job: { ...fresh, name: project.job.name, files: project.cached ? project.job.files : fresh.files }, ...(project.cached ? { remoteFiles: fresh.files } : {}) }); setStatus('현재 서버의 파일 주소로 연결했어요.'); })} />}
    <Text style={ui.small}>파일을 잃었거나 다른 기기에서 기록을 복원했다면 각 레이어 파일을 다시 연결하세요.</Text>
    {Object.keys(project.job.files ?? {}).map(stem => <Button key={stem} title={`${STEM_LABELS[stem] ?? stem} 파일 다시 연결`} secondary disabled={busy} onPress={() => void run(async () => { const r = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true }); if (r.canceled) return; const uri = await saveMedia(r.assets[0].uri, /\.[a-zA-Z0-9]+$/.exec(r.assets[0].name)?.[0] ?? '.wav'); const previous = project.job.files?.[stem]; patchProject(id, { job: { ...project.job, files: { ...project.job.files, [stem]: uri } } }); if (previous) await deleteMedia(previous); setStatus('레이어 파일을 다시 연결했어요.'); })} />)}
    <Button title="프로젝트와 기록 삭제" secondary disabled={busy} onPress={() => confirmAction('프로젝트 삭제', '이 프로젝트의 세션, 동작 분석, 보관 파일이 기기에서 삭제됩니다. 서버 원본은 유지됩니다.', () => void run(async () => { await removeProject(id); router.replace('/workspace'); }))} />{!!status && <Text accessibilityLiveRegion="polite" style={ui.body}>{status}</Text>}</Card>
    <Section title="음악 레이어" /><Card><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{project.job.stems?.map(s => <Text key={s} style={ui.pill}>{STEM_LABELS[s] ?? s}</Text>)}</View><Text style={ui.body}>세션 안에서 볼륨, 음소거와 솔로를 조절할 수 있어요.</Text></Card>
    <Section title={`세션 기록 · ${sessions.length}`} />{sessions.length ? sessions.map(s => <Card key={s.id}><View style={ui.between}><Text style={ui.h3}>{new Date(s.startedAt).toLocaleDateString('ko-KR')}</Text><Text style={ui.pill}>{s.endedAt ? '마침' : '이어서 가능'}</Text></View><Text style={ui.body}>{fmtTime(s.listened)} 재생 · 마지막 위치 {fmtTime(s.position)}</Text>{!s.endedAt && <Button secondary title="이 세션 이어하기" onPress={() => router.push({ pathname: '/device', params: { project: project.id, resume: s.id } })} />}<Button title="이 세션에 동작 분석 추가" secondary onPress={() => router.push({ pathname: '/motion', params: { project: project.id, session: s.id } })} /><Button title="세션 기록 삭제" secondary onPress={() => confirmAction('세션 삭제', '이 재생 기록이 미션과 통계에서도 제외됩니다.', () => removeSession(s.id))} /></Card>) : <Text style={ui.body}>첫 세션을 시작하면 연습 기록이 쌓여요.</Text>}
  </Page>;
}
