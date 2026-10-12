import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useLibrary } from '../state/LibraryProvider';
import { C, fmtTime } from '../theme';
import { Card, Empty, Heading, Page, ui } from '../ui/Kit';
import { ProjectCard } from '../ui/ProjectCard';
export default function Workspace() {
  const { data } = useLibrary(); const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState(params.tab ?? 'projects'), [query, setQuery] = useState('');
  const projects = data.projects.filter(p => p.job.name.toLowerCase().includes(query.toLowerCase()) && (tab !== 'saved' || p.saved));
  return <Page><Heading title="나의 워크스페이스" caption="YOUR RHYTHM, COLLECTED" /><TextInput accessibilityLabel="프로젝트 검색" placeholder="음악, 프로젝트 검색" placeholderTextColor={C.dim} value={query} onChangeText={setQuery} style={ui.input} />
    <View style={ui.row}>{[['projects', '프로젝트'], ['history', '미션 기록'], ['saved', '저장됨']].map(([id, title]) => <Pressable key={id} accessibilityRole="button" accessibilityState={{ selected: tab === id }} onPress={() => setTab(id)} style={{ flex: 1, alignItems: 'center', paddingVertical: 13, borderBottomWidth: 2, borderBottomColor: tab === id ? C.accent : 'transparent' }}><Text style={{ color: tab === id ? C.accent : C.sub, fontWeight: '600', fontSize: 13 }}>{title}</Text></Pressable>)}</View>
    {tab === 'history' ? <>{data.sessions.filter(s => s.endedAt && s.missionWeek && s.listened > 0).length === 0 ? <Empty icon="flag-outline" title="아직 미션 기록이 없어요" detail="이번 주 미션에 참여하고 세션을 마치면 여기에 쌓여요." action="미션 살펴보기" onPress={() => router.push('/mission')} /> : data.sessions.filter(s => s.endedAt && s.missionWeek && s.listened > 0).map(s => <Card key={s.id}><Text style={ui.pill}>{s.listened >= 30 ? '미션 세션 완료' : '30초 목표 진행 중'}</Text><Text style={ui.h3}>{data.projects.find(p => p.id === s.projectId)?.job.name ?? '음악 세션'}</Text><Text style={ui.body}>{new Date(s.startedAt).toLocaleDateString('ko-KR')} · {fmtTime(s.listened)} 재생</Text></Card>)}</> : <><Text style={ui.small}>{projects.length}개의 {tab === 'saved' ? '저장된 프로젝트' : '프로젝트'}</Text>{projects.length ? projects.map(p => <ProjectCard key={p.id} project={p} />) : <Empty icon={tab === 'saved' ? 'bookmark-outline' : 'albums-outline'} title={tab === 'saved' ? '좋아하는 음악을 모아보세요' : '나의 첫 프로젝트'} detail={tab === 'saved' ? '프로젝트의 북마크를 누르면 이곳에 저장돼요.' : '음악을 가져오고, 레이어로 나눠 자유롭게 연습해요.'} action="새 세션 시작" onPress={() => router.push('/new-session')} />}</>}
  </Page>;
}
