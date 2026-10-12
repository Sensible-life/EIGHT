import { router } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { useLibrary } from '../state/LibraryProvider';
import { missionProgress, weekKey } from '../state/model';
import { C, fmtTime } from '../theme';
import { Button, Card, Empty, Heading, Icon, MotionArt, Page, Section, ui } from '../ui/Kit';
export default function Mission() {
  const { data, joinMission, updateExtras } = useLibrary(); const [feed, setFeed] = useState(false);
  const goal = data.extras?.missionGoal ?? 3;
  const joined = data.joinedWeeks.includes(weekKey()), progress = missionProgress(data.sessions, weekKey(), goal);
  const activity = data.sessions.filter(s => s.endedAt && s.listened > 0);
  return <Page><View style={ui.between}><Heading title="움직일 이유, 하나 더" caption="MAKE YOUR MOVE" /><Pressable accessibilityRole="button" accessibilityLabel="미션 기록" style={{ padding: 10 }} onPress={() => router.push({ pathname: '/workspace', params: { tab: 'history' } })}><Image source={require('../../assets/figma/mission-history.png')} style={{ width: 26, height: 26 }} /></Pressable></View>
    <View style={ui.row}>{['이번 주 미션', '나의 피드'].map((label, i) => <Pressable key={label} accessibilityRole="button" accessibilityState={{ selected: feed === !!i }} onPress={() => setFeed(!!i)} style={[ui.button, { flex: 1, backgroundColor: feed === !!i ? C.accent : C.card }]}><Text style={[ui.buttonText, feed !== !!i && { color: C.sub }]}>{label}</Text></Pressable>)}</View>
    <Button title="커뮤니티 체험 · 로컬 피드" secondary onPress={() => router.push('/community')} />
    {!joined && <Card><Text style={ui.h3}>이번 주 목표 정하기</Text><View style={ui.row}>{[1,3,5].map(n => <Button key={n} title={`${n}회${goal === n ? ' ✓' : ''}`} secondary onPress={() => updateExtras(e => ({ ...e, missionGoal: n }))} />)}</View></Card>}
    {progress >= goal && <Card><Text style={ui.h3}>이번 주 리듬 배지</Text><Button title={data.extras?.badges.includes(weekKey()) ? '배지 획득 완료 ✓' : '완료 배지 받기'} disabled={data.extras?.badges.includes(weekKey())} onPress={() => updateExtras(e => ({ ...e, badges: [...new Set([...e.badges, weekKey()])] }))} /><Text style={ui.small}>모은 배지 {data.extras?.badges.length ?? 0}개 · 기기에 저장</Text></Card>}
    {feed ? <><Text style={ui.body}>내 기기에 저장된 세션 활동이에요.</Text>{activity.length ? activity.map(s => <Card key={s.id}><View style={ui.row}><View style={ui.iconCircle}><Icon name="checkmark" color={C.accent} /></View><View style={{ flex: 1 }}><Text style={ui.h3}>나만의 리듬을 발견했어요</Text><Text style={ui.small}>{new Date(s.startedAt).toLocaleString('ko-KR')}</Text></View></View><Text style={ui.body}>{data.projects.find(p => p.id === s.projectId)?.job.name ?? '음악 세션'} · {fmtTime(s.listened)} 재생</Text></Card>) : <Empty icon="sparkles-outline" title="오늘의 움직임을 남겨보세요" detail="세션을 마치면 내 활동이 이곳에 기록돼요." action="세션 시작" onPress={() => router.push('/new-session')} />}</> : <>
      <Card style={{ backgroundColor: '#EFDCF5', padding: 24 }}><Text style={ui.pill}>WEEKLY · {weekKey().slice(5).replace('-', '.')}</Text><Text style={[ui.title, { marginTop: 6 }]}>비트에 집중하는{ '\n' }나만의 {goal}번</Text><MotionArt /><Text style={ui.body}>좋아하는 음악으로 30초 이상 연습하고{ '\n' }세션을 마쳐보세요. 이번 주 목표는 {goal}번!</Text><View style={[ui.row, { marginVertical: 12 }]}>{Array.from({ length: goal }, (_, i) => i + 1).map(n => <View key={n} style={{ flex: 1, height: 52, backgroundColor: progress >= n ? C.accent : '#FFF9', borderRadius: 17, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: progress >= n ? '#FFF' : C.accent, fontSize: 19, fontWeight: '700' }}>{progress >= n ? '✓' : `0${n}`}</Text></View>)}</View><Button title={progress === goal ? '미션 완료 · 기록 보기' : joined ? '연습 시작하기' : '이번 주 미션 참여하기'} onPress={() => { if (!joined) joinMission(); else router.push(progress === goal ? '/workspace' : '/new-session'); }} icon={progress === goal ? 'checkmark-circle' : 'arrow-forward'} /><Text style={[ui.small, { textAlign: 'center' }]}>{joined ? `${progress}/${goal} 완료 · 참여 후 시작한 세션을 집계해요.` : '매주 월요일, 새로운 연습 기록을 시작해요.'}</Text></Card>
      <Section title="이렇게 연습해 보세요" /><Card><Text style={ui.h3}>01. 베이스만 따라 움직이기</Text><Text style={ui.body}>믹서에서 베이스의 솔로를 켜고, 낮은 리듬에 집중해 보세요.</Text><View style={ui.line} /><Text style={ui.h3}>02. 손목으로 비트 느끼기</Text><Text style={ui.body}>갤럭시 워치의 진동과 함께 킥드럼의 타이밍을 느껴보세요.</Text></Card>
    </>}
  </Page>;
}
