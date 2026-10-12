import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useLibrary } from '../state/LibraryProvider';
import { missionProgress, weekKey } from '../state/model';
import { C } from '../theme';
import { Button, Card, Icon, Label, MotionArt, Page, Section, ui } from '../ui/Kit';
export default function Home() {
  const { data, choose } = useLibrary();
  const recent = data.sessions.find(s => !s.endedAt && data.projects.some(p => p.id === s.projectId));
  const project = data.projects.find(p => p.id === recent?.projectId) ?? data.projects[0];
  const minutes = Math.floor(data.sessions.reduce((sum, s) => sum + s.listened, 0) / 60);
  const completed = data.sessions.filter(s => s.endedAt && s.listened > 0).length;
  const goal = data.extras?.missionGoal ?? 3;
  const progress = missionProgress(data.sessions, weekKey(), goal), joined = data.joinedWeeks.includes(weekKey());
  const resume = () => { if (!project) { router.push('/new-session'); return; } choose(project.id); router.push({ pathname: '/device', params: { project: project.id, resume: recent?.projectId === project.id ? recent.id : '' } }); };
  return <Page><View style={{ gap: 6 }}><Label>FIND YOUR OWN RHYTHM</Label><Text style={ui.title}>오늘은 어떤 리듬으로{ '\n' }움직여 볼까요?</Text><Text style={ui.body}>음악을 느끼고, 나만의 움직임을 발견해요.</Text></View>
    <Pressable accessibilityRole="button" accessibilityLabel="이번 주 미션 보기" onPress={() => router.push('/mission')} style={[ui.card, { backgroundColor: '#F1DCF5', overflow: 'hidden', paddingBottom: 18 }]}><View style={ui.between}><Text style={[ui.pill, { backgroundColor: '#FFF8' }]}>WEEKLY MISSION</Text><Icon name="arrow-forward" color={C.accent} size={20} /></View><Text style={[ui.h2, { fontSize: 25, lineHeight: 34 }]}>비트에 집중하는{ '\n' }나만의 {goal}번</Text><View style={{ position: 'absolute', right: -36, top: 42, width: 215, opacity: .8 }}><MotionArt small /></View><Text style={[ui.body, { maxWidth: 200 }]}>30초씩, {goal}번의 리듬 연습</Text><View style={[ui.row, { marginTop: 16 }]}><View style={{ flex: 1, height: 5, backgroundColor: '#DFC2E6', borderRadius: 5 }}><View style={{ width: `${progress / goal * 100}%`, height: 5, borderRadius: 5, backgroundColor: C.accent }} /></View><Text style={ui.link}>{joined ? `${progress} / ${goal}` : '참여하기'}</Text></View></Pressable>
    <Section title="최근 세션 이어하기" action={project ? '모두 보기' : undefined} onPress={() => router.push('/workspace')} />
    <Card><View style={ui.row}><View style={ui.iconCircle}><Icon name={project ? 'headset-outline' : 'musical-notes-outline'} color={C.accent} /></View><View style={{ flex: 1, gap: 5 }}><Text style={ui.h3} numberOfLines={1}>{project ? project.job.name.replace(/\.[^.]+$/, '') : '첫 리듬을 만나볼 시간'}</Text><Text style={ui.small}>{project ? `${project.job.stems?.length ?? 0}개 레이어 · ${recent ? '저장된 지점부터 계속' : '새 세션 시작'}` : '음악을 고르면 나만의 연습이 시작돼요.'}</Text></View></View><Button title={recent ? '세션 이어가기' : project ? '이 음악으로 새 세션' : '음악 선택하기'} onPress={resume} icon="play" secondary /></Card>
    <Section title="나의 리듬 인사이트" action="자세히" onPress={() => router.push('/analysis')} />
    <View style={{ flexDirection: 'row', gap: 12 }}><Card style={{ flex: 1, padding: 18 }}><Icon name="time-outline" color={C.accent} /><Text style={[ui.title, { marginTop: 8 }]}>{minutes}<Text style={ui.body}> 분</Text></Text><Text style={ui.small}>누적 음악 재생</Text></Card><Card style={{ flex: 1, padding: 18 }}><Icon name="checkmark-done-outline" color={C.accent} /><Text style={[ui.title, { marginTop: 8 }]}>{completed}<Text style={ui.body}> 회</Text></Text><Text style={ui.small}>마친 세션</Text></Card></View>
    <Text style={[ui.small, { textAlign: 'center', marginTop: 6 }]}>작은 움직임도, 나만의 리듬이 됩니다.</Text>
  </Page>;
}
