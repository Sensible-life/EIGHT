import { Text } from '../ui/Typography';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { focusSummary, selectSessions } from '../analysis/summary';
import BodyBalanceCard from '../components/tracking/BodyBalanceCard';
import TrackingMovesCard from '../components/tracking/TrackingMovesCard';
import TrackingSpaceCard from '../components/tracking/TrackingSpaceCard';
import { useLibrary } from '../state/LibraryProvider';
import { layerShares } from '../state/model';
import { C, fmtTime, STEM_LABELS } from '../theme';
import { DEFAULT_CONFIG } from '../tracking/config';
import { Button, Card, Icon, Page, ui } from '../ui/Kit';
import VideoPreview from '../ui/VideoPreview';
import { ScreenTabs, SectionTitle } from '../ui/ScreenParts';

type Category = 'overview' | 'movement' | 'layers' | 'sessions';
const categoryLabels: [Category, string][] = [['overview', 'Overview'], ['movement', 'Movement'], ['layers', 'Layers'], ['sessions', 'Sessions']];
export default function Insights() {
  const { data } = useLibrary();
  const params = useLocalSearchParams<{ project?: string }>();
  const [projectId, setProjectId] = useState<string | null>(() => params.project ?? null);
  const [period, setPeriod] = useState<'week' | 'all'>('all'), [category, setCategory] = useState<Category>('overview');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null), [selectedVideo, setSelectedVideo] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const { width, fontScale } = useWindowDimensions();
  const project = data.projects.find(item => item.id === projectId);
  const scope = project?.id ?? null;
  const since = period === 'week' ? now - 7 * 86400000 : null;
  const sessions = selectSessions(data.sessions, scope, since);
  const motions = (data.extras?.motions ?? []).filter(m => (!scope || m.projectId === scope) && (since === null || m.createdAt >= since)).sort((a, b) => b.createdAt - a.createdAt);
  const selectedSession = sessions.find(session => session.id === selectedSessionId);
  const previousSession = selectedSession && sessions.find(session => session.projectId === selectedSession.projectId && session.startedAt < selectedSession.startedAt);
  const selectedVideos = (data.extras?.motifs ?? []).filter(item => item.sessionId === selectedSession?.id && !!item.video);
  const selectedVideoItem = selectedVideos.find(item => item.id === selectedVideo);
  const seconds = sessions.reduce((sum, session) => sum + session.listened, 0);
  const played = sessions.filter(session => session.listened > 0);
  const tracked = sessions.filter(session => session.tracking && session.tracking.trackedMs >= DEFAULT_CONFIG.app.min_tracked_s * 1000);
  const layers = layerShares(sessions);
  const focused = focusSummary(data.extras?.timelines ?? [], scope);
  const draft = project && data.extras?.timelines.find(t => t.projectId === project.id);
  const clips = [...(draft?.clips ?? [])].sort((a, b) => a.start - b.start);
  const setScope = (id: string | null) => { setProjectId(id); setSelectedSessionId(null); setSelectedVideo(null); };
  const sessionName = (id: string) => data.projects.find(item => item.id === id)?.job.name.replace(/\.[^.]+$/, '') ?? 'Project';
  const narrow = width < 340 || fontScale > 1.25;
  const sessionDetails = selectedSession && <><Text style={ui.h2}>Session details</Text>{previousSession && <Card style={{ borderRadius: 16 }}><Text style={ui.h3}>Previous session</Text><Text style={ui.small}>Same project · {new Date(previousSession.startedAt).toLocaleDateString('en-US')}</Text><View style={{ flexDirection: 'row', gap: 12 }}><View style={{ flex: 1 }}><Text style={ui.small}>This session</Text><Text style={ui.h2}>{fmtTime(selectedSession.listened)}</Text></View><View style={{ flex: 1 }}><Text style={ui.small}>Previous session</Text><Text style={ui.h2}>{fmtTime(previousSession.listened)}</Text></View></View><Text style={ui.small}>Listening time in the selected period.</Text></Card>}<TrackingSpaceCard sessions={[selectedSession]} /><BodyBalanceCard sessions={[selectedSession]} />{selectedVideos.length > 0 && <Card style={{ borderRadius: 16 }}><Text style={ui.h3}>Recorded videos</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7 }}>{selectedVideos.map(video => <Pressable key={video.id} accessibilityRole="button" accessibilityState={{ selected: selectedVideo === video.id }} onPress={() => setSelectedVideo(selectedVideo === video.id ? null : video.id)} style={{ width: 142, minHeight: 64, padding: 10, borderRadius: 10, justifyContent: 'center', backgroundColor: selectedVideo === video.id ? C.cardHi : C.bg }}><Text numberOfLines={1} style={ui.h3}>{video.name}</Text><Text style={ui.small}>{fmtTime(video.start)} – {fmtTime(video.end)}</Text></Pressable>)}</ScrollView>{selectedVideoItem?.video && <VideoPreview key={selectedVideoItem.id} uri={selectedVideoItem.video} />}</Card>}</>;
  return <Page>
    <View style={{ gap: 10 }}><View style={ui.between}><View><Text style={ui.h3}>Practice scope</Text><Text style={ui.small}>{scope ? 'Project analysis' : 'Across all projects'}</Text></View><Icon name="options-outline" size={19} color={C.dim} /></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7 }}>
        <Pressable accessibilityRole="button" accessibilityState={{ selected: !scope }} onPress={() => setScope(null)} style={{ minHeight: 38, paddingHorizontal: 14, borderRadius: 20, backgroundColor: !scope ? C.text : C.card, justifyContent: 'center' }}><Text style={{ color: !scope ? '#FFF' : C.sub, fontSize: 12 }}>All projects</Text></Pressable>
        {data.projects.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: scope === item.id }} accessibilityLabel={`Filter by ${item.job.name}`} onPress={() => setScope(item.id)} style={{ minHeight: 38, maxWidth: 180, paddingHorizontal: 14, borderRadius: 20, backgroundColor: scope === item.id ? C.text : C.card, justifyContent: 'center' }}><Text numberOfLines={1} style={{ color: scope === item.id ? '#FFF' : C.sub, fontSize: 12 }}>{item.job.name.replace(/\.[^.]+$/, '')}</Text></Pressable>)}
      </ScrollView>
    </View>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><Text style={[ui.small, { flex: 1 }]}>PERIOD</Text>{([['week', 'Last 7 days'], ['all', 'All time']] as const).map(([key, title]) => <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected: period === key }} onPress={() => { setPeriod(key); setSelectedSessionId(null); setSelectedVideo(null); }} style={{ minHeight: 36, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 18, backgroundColor: period === key ? C.cardHi : 'transparent' }}><Text style={{ fontSize: 12, color: period === key ? C.accent : C.sub }}>{title}</Text></Pressable>)}</View>
    <ScreenTabs items={categoryLabels} value={category} onChange={setCategory} />
    {category === 'overview' && <>
      <SectionTitle title="Your practice" detail={scope ? 'Selected project' : 'All projects'} />
      <View style={{ flexDirection: narrow ? 'column' : 'row', gap: 10 }}><View style={{ flex: 1.2, borderRadius: 14, padding: 16, minHeight: 126, backgroundColor: '#F1DCF5', justifyContent: 'space-between' }}><Icon name="time-outline" color={C.accent} size={20} /><View><Text style={{ color: C.text, fontSize: 26, lineHeight: 32, fontFamily: 'SpaceGrotesk_600SemiBold' }}>{fmtTime(seconds)}</Text><Text style={ui.small}>Listening time</Text></View></View><View style={{ flex: 1, gap: 10 }}><View style={{ flex: 1, borderRadius: 14, padding: 13, backgroundColor: C.card, flexDirection: 'row', alignItems: 'center', gap: 10 }}><Icon name="play-circle-outline" color={C.accent} size={20} /><View><Text style={ui.h3}>{played.length}</Text><Text style={ui.small}>Sessions played</Text></View></View><View style={{ flex: 1, borderRadius: 14, padding: 13, backgroundColor: C.card, flexDirection: 'row', alignItems: 'center', gap: 10 }}><Icon name="camera-outline" color={C.accent} size={20} /><View><Text style={ui.h3}>{tracked.length}</Text><Text style={ui.small}>Tracked sessions</Text></View></View></View></View>
      <SectionTitle title="Explore insights" />
      <View style={{ flexDirection: narrow ? 'column' : 'row', gap: 10 }}>{([['movement', 'Movement', 'body-outline', tracked.length ? `${tracked.length} tracked sessions` : 'No camera data yet'], ['layers', 'Focus layers', 'musical-notes-outline', focused.taggedClips ? `${focused.taggedClips} tagged clips` : 'No focus layers yet']] as const).map(([key, title, icon, detail]) => <Pressable key={key} accessibilityRole="button" onPress={() => setCategory(key)} style={{ flex: 1, minWidth: 0, minHeight: 120, backgroundColor: C.card, borderRadius: 14, padding: 14, justifyContent: 'space-between', gap: 10 }}><View style={ui.between}><Icon name={icon} color={C.accent} size={21} /><Icon name="arrow-forward" color={C.dim} size={17} /></View><View><Text style={ui.h3}>{title}</Text><Text style={ui.small}>{detail}</Text></View></Pressable>)}</View>
      <View style={ui.between}><Text style={ui.h2}>Recent sessions</Text><Pressable accessibilityRole="button" onPress={() => setCategory('sessions')} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={ui.link}>View all</Text></Pressable></View>
      {sessions.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>{sessions.slice(0, 5).map(session => <Pressable key={session.id} accessibilityRole="button" onPress={() => { setSelectedSessionId(session.id); setSelectedVideo(null); setCategory('sessions'); }} style={{ width: 150, minHeight: 96, backgroundColor: C.card, borderRadius: 14, padding: 12, justifyContent: 'space-between' }}><Text numberOfLines={1} style={ui.h3}>{sessionName(session.projectId)}</Text><Text style={ui.small}>{new Date(session.startedAt).toLocaleDateString('en-US')} · {fmtTime(session.listened)}</Text></Pressable>)}</ScrollView> : <Text style={ui.body}>No sessions in this period.</Text>}
    </>}
    {category === 'movement' && <><SectionTitle title="Movement" detail="Body and space" /><BodyBalanceCard sessions={sessions} latest={motions[0]?.result} /><TrackingMovesCard sessions={sessions} /><Card style={{ borderRadius: 16 }}><Text style={ui.h3}>Space by session</Text><Text style={ui.body}>Each heatmap uses that session’s camera position. Select a session to view it separately.</Text><Button title="View sessions" secondary onPress={() => setCategory('sessions')} /></Card><Button title="Motion studio" secondary onPress={() => router.push({ pathname: '/motion', params: scope ? { project: scope } : {} })} /></>}
    {category === 'layers' && <>
      <SectionTitle title="Layer insights" detail="Choreography focus and listening" />
      <Card style={{ borderRadius: 16 }}><Text style={ui.h3}>Focus layers</Text><Text style={ui.small}>Layers you selected for clips in current project timelines · all time</Text>{focused.layers.length ? <>{focused.layers.map(item => <View key={item.stem} style={{ gap: 5, marginTop: 4 }}><View style={ui.between}><Text style={ui.body}>{STEM_LABELS[item.stem] ?? item.stem}</Text><Text style={ui.link}>{item.clips} {item.clips === 1 ? 'clip' : 'clips'} · {fmtTime(item.seconds)}</Text></View><View style={{ height: 7, borderRadius: 5, backgroundColor: C.bg }}><View style={{ height: 7, borderRadius: 5, backgroundColor: C.accent, width: `${focused.taggedClips ? item.clips / focused.taggedClips * 100 : 0}%` }} /></View></View>)}<Text style={ui.small}>{focused.taggedClips} of {focused.totalClips} clips tagged. A clip can have multiple focus layers, so totals can overlap.</Text></> : <Text style={ui.body}>No focus layers selected. Tag a clip in a project’s choreography timeline.</Text>}{project && <Button title="Edit timeline" secondary onPress={() => router.push({ pathname: '/editor', params: { id: project.id } })} />}</Card>
      {project && clips.length > 0 && <Card style={{ borderRadius: 16 }}><Text style={ui.h3}>Timeline clips</Text>{clips.map(clip => <View key={clip.id} style={{ borderTopWidth: 1, borderTopColor: C.line, paddingTop: 8, gap: 3 }}><Text style={ui.h3}>{fmtTime(clip.start)} – {fmtTime(clip.start + clip.duration)}</Text><Text style={ui.small}>{(data.extras?.motifs ?? []).find(m => m.id === clip.motifId)?.name ?? 'Video'} · {clip.focusLayers?.length ? clip.focusLayers.map(stem => STEM_LABELS[stem] ?? stem).join(' + ') : 'No focus layer'}</Text></View>)}</Card>}
      <Card style={{ borderRadius: 16 }}><Text style={ui.h3}>Listening by layer</Text><Text style={ui.small}>Share of audible layer time during practice. Layers can play together; this does not indicate choreography focus.</Text>{layers.length ? layers.slice(0, 6).map(item => <View key={item.stem} style={ui.between}><Text style={ui.body}>{STEM_LABELS[item.stem] ?? item.stem}</Text><Text style={ui.link}>{Math.round(item.share * 100)}%</Text></View>) : <Text style={ui.body}>No listening history in this period.</Text>}</Card>
    </>}
    {category === 'sessions' && <><SectionTitle title="Sessions" detail="Select a session for camera data and videos." />{sessions.length ? sessions.map(session => { const selected = selectedSessionId === session.id; const videos = (data.extras?.motifs ?? []).filter(item => item.sessionId === session.id && !!item.video).length; return <View key={session.id} style={{ gap: 10 }}><Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={() => { setSelectedSessionId(selected ? null : session.id); setSelectedVideo(null); }} style={{ backgroundColor: selected ? C.cardHi : C.card, borderRadius: 14, padding: 14, gap: 5 }}><View style={ui.between}><Text style={[ui.h3, { flex: 1 }]} numberOfLines={1}>{scope ? new Date(session.startedAt).toLocaleDateString('en-US') : sessionName(session.projectId)}</Text><Icon name={selected ? 'chevron-up' : 'chevron-down'} color={C.dim} size={18} /></View><Text style={ui.small}>{!scope ? `${new Date(session.startedAt).toLocaleDateString('en-US')} · ` : ''}{fmtTime(session.listened)} played · {videos} {videos === 1 ? 'video' : 'videos'}</Text></Pressable>{selected && sessionDetails}</View>; }) : <Card style={{ borderRadius: 16 }}><Text style={ui.body}>No sessions in this period.</Text></Card>}

    </>}
  </Page>;
}
