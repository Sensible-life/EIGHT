import { Text, TextInput } from '../ui/Typography';
import { router, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useLibrary } from '../state/LibraryProvider';
import { deleteMedia, resolveMedia } from '../storage/media';
import { C, fmtTime } from '../theme';
import { confirmAction } from '../ui/confirm';
import { displayMessage } from '../ui/displayMessage';
import { Button, Card, Empty, Icon, Page, ui } from '../ui/Kit';
import { ProjectCard } from '../ui/ProjectCard';
import VideoPreview from '../ui/VideoPreview';

type Tab = 'projects' | 'saved' | 'history';
export default function Workspace() {
  const { data, updateExtras } = useLibrary(); const params = useLocalSearchParams<{ tab?: string }>();
  const { width, fontScale } = useWindowDimensions(); const twoColumns = width >= 340 && fontScale <= 1.2;
  const [tab, setTab] = useState<Tab>(params.tab === 'history' || params.tab === 'saved' ? params.tab : 'projects');
  const [query, setQuery] = useState(''), [selected, setSelected] = useState<string | null>(null), [message, setMessage] = useState('');
  const [renameId, setRenameId] = useState<string | null>(null), [renameValue, setRenameValue] = useState('');
  const search = query.trim().toLowerCase();
  const projects = data.projects.filter(p => p.job.name.toLowerCase().includes(search));
  const finished = (data.extras?.finished ?? []).filter(v => v.name.toLowerCase().includes(search));
  const history = data.sessions.filter(s => !!s.missionWeek).sort((a, b) => b.startedAt - a.startedAt);
  const filteredHistory = history.filter(s => [s.missionWeek, s.missionTitle, 'weekly mission', data.projects.find(p => p.id === s.projectId)?.job.name, new Date(s.startedAt).toLocaleDateString('en-US')].some(value => value?.toLowerCase().includes(search)));
  const weeks = [...new Set(filteredHistory.map(s => s.missionWeek!))];
  const gridWidth = twoColumns ? '48.5%' : '100%';
  const share = async (uri: string, name: string) => {
    try {
      const media = await resolveMedia(uri);
      try {
        if (Platform.OS === 'web') { const a = document.createElement('a'); a.href = media.uri; a.download = `${name.replace(/[^\w .-]/g, '_') || 'choreography'}.mp4`; a.click(); await new Promise(resolve => setTimeout(resolve, 1000)); }
        else if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(media.uri, { mimeType: 'video/mp4', dialogTitle: name });
        else throw new Error('Sharing is not available on this device.');
      } finally { media.release(); }
    } catch (error) { setMessage(displayMessage(error)); }
  };
  return <Page>
    <View style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 15, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 12 }}>
      <Icon name="search-outline" size={19} color={C.dim} />
      <TextInput accessibilityLabel={tab === 'projects' ? 'Search projects' : tab === 'saved' ? 'Search finished videos' : 'Search mission history'} placeholder={tab === 'projects' ? 'Search projects' : tab === 'saved' ? 'Search finished videos' : 'Search mission history'} placeholderTextColor={C.dim} value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false} returnKeyType="search" underlineColorAndroid="transparent" style={{ flex: 1, minWidth: 0, minHeight: 46, padding: 0, color: C.text, fontSize: 14 }} />
      {!!query && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQuery('')} hitSlop={10}><Icon name="close-circle" size={18} color={C.dim} /></Pressable>}
    </View>
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.line }}>{([['projects', 'Projects', data.projects.length], ['saved', 'Saved', data.extras?.finished.length ?? 0], ['history', 'Mission history', history.length]] as const).map(([key, title, count]) => <Pressable key={key} accessibilityRole="tab" accessibilityLabel={`${title}, ${count}`} accessibilityState={{ selected: tab === key }} onPress={() => { setTab(key); setSelected(null); setQuery(''); }} style={{ flex: 1, minWidth: 0, minHeight: 48, justifyContent: 'center', alignItems: 'center', borderBottomWidth: 2, borderBottomColor: tab === key ? C.accent : 'transparent', marginBottom: -1 }}><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ alignSelf: 'stretch', textAlign: 'center', color: tab === key ? C.accent : C.sub, fontFamily: tab === key ? 'SpaceGrotesk_600SemiBold' : 'SpaceGrotesk_500Medium', fontSize: width < 360 ? 11 : 12 }}>{title} <Text style={{ fontSize: 11, color: tab === key ? C.accent : C.dim }}>{count}</Text></Text></Pressable>)}</View>
    {tab === 'projects' && (projects.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 }}>{projects.map(p => <View key={p.id} style={{ width: gridWidth }}><ProjectCard project={p} tile /></View>)}</View> : <Empty icon="albums-outline" title={query ? 'No results' : 'No projects'} detail={query ? 'Try a different search.' : 'Choose music to start a project.'} action="Start a session" onPress={() => router.push('/new-session')} />)}
    {tab === 'saved' && (finished.length ? <><Text style={ui.small}>Finished choreography · MP4 files on this device</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 }}>{finished.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: selected === item.id }} onPress={() => setSelected(selected === item.id ? null : item.id)} style={{ width: gridWidth, minHeight: 130, padding: 14, borderRadius: 12, backgroundColor: selected === item.id ? C.cardHi : C.card, justifyContent: 'space-between' }}><View style={ui.between}><View style={ui.iconCircle}><Icon name="play-outline" color={C.accent} /></View><Text style={ui.small}>MP4</Text></View><View><Text style={ui.h3} numberOfLines={1}>{item.name}</Text><Text style={ui.small}>{new Date(item.createdAt).toLocaleDateString('en-US')} · {item.clips.length} clips</Text></View></Pressable>)}</View>{finished.filter(item => item.id === selected).map(item => <Card key={item.id} style={{ borderRadius: 16 }}><Text style={ui.h2}>{item.name}</Text>{renameId === item.id ? <View style={{ gap: 8 }}><TextInput accessibilityLabel="Video name" value={renameValue} onChangeText={setRenameValue} maxLength={100} style={{ backgroundColor: C.bg, color: C.text, borderRadius: 10, padding: 12 }} /><View style={{ flexDirection: 'row', gap: 8 }}><Button title="Save name" disabled={!renameValue.trim()} onPress={() => { const name = renameValue.trim(); if (!name) return; updateExtras(e => ({ ...e, finished: e.finished.map(f => f.id === item.id ? { ...f, name } : f) })); setRenameId(null); }} /><Button title="Cancel" secondary onPress={() => setRenameId(null)} /></View></View> : <Button title="Rename" secondary onPress={() => { setRenameValue(item.name); setRenameId(item.id); }} />}<VideoPreview uri={item.video} /><View style={{ flexDirection: 'row', gap: 8 }}><View style={{ flex: 1 }}><Button title="Share MP4" secondary onPress={() => void share(item.video, item.name)} /></View><View style={{ flex: 1 }}><Button title="Delete" secondary onPress={() => confirmAction('Delete finished video', 'The MP4 will be removed. The project and its timeline will remain.', () => { updateExtras(e => ({ ...e, finished: e.finished.filter(f => f.id !== item.id) })); void deleteMedia(item.video); setSelected(null); })} /></View></View></Card>)}</> : <Empty icon="film-outline" title={query ? 'No results' : 'No finished videos'} detail={query ? 'Try a different search.' : 'Finish and save a choreography from a project to create an MP4.'} />)}
    {tab === 'history' && (weeks.length ? weeks.map(week => {
      const sessions = filteredHistory.filter(s => s.missionWeek === week);
      return <Card key={week} style={{ borderRadius: 16 }}><View style={ui.between}><View><Text style={ui.h2}>Weekly mission</Text><Text style={ui.small}>Week of {week}</Text></View><Text style={ui.pill}>{sessions.filter(s => !!s.endedAt && s.listened >= 30).length} completed</Text></View>{sessions.map(s => {
        const recordings = (data.extras?.motifs ?? []).filter(m => m.sessionId === s.id && !!m.video);
        return <View key={s.id} style={{ borderTopWidth: 1, borderTopColor: C.line, paddingTop: 10, gap: 8 }}><View style={ui.between}><View style={{ flex: 1 }}><Text style={ui.h3} numberOfLines={1}>{s.missionTitle ?? 'Weekly mission'} · {data.projects.find(p => p.id === s.projectId)?.job.name ?? 'Practice'}</Text><Text style={ui.small}>{new Date(s.startedAt).toLocaleDateString('en-US')} · {fmtTime(s.listened)} played</Text></View><Text style={ui.small}>{s.endedAt && s.listened >= 30 ? 'Completed' : 'In progress'}</Text></View>{!!recordings.length && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7 }}>{recordings.map(v => <Pressable key={v.id} accessibilityRole="button" onPress={() => setSelected(selected === v.id ? null : v.id)} style={{ backgroundColor: selected === v.id ? C.cardHi : C.bg, borderRadius: 10, padding: 10, minWidth: 120 }}><Icon name="videocam-outline" size={18} color={C.accent} /><Text style={ui.small} numberOfLines={1}>{v.name}</Text></Pressable>)}</ScrollView>}{recordings.filter(v => v.id === selected).map(v => <VideoPreview key={v.id} uri={v.video!} />)}</View>;
      })}</Card>;
    }) : <Empty icon="flag-outline" title={search ? 'No results' : 'No mission history yet'} detail={search ? 'Try a different search.' : 'Practice after joining a weekly mission to see records and videos here.'} {...(!search ? { action: 'View missions', onPress: () => router.push('/mission') } : {})} />)}
    {!!message && <Text accessibilityLiveRegion="polite" style={ui.body}>{message}</Text>}
  </Page>;
}
