import { Text } from '../ui/Typography';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import ServiceMission from '../components/ServiceMission';
import { useLibrary } from '../state/LibraryProvider';
import { missionProgress, weekKey } from '../state/model';
import { trackingInsights } from '../tracking/insights';
import { C } from '../theme';
import { Button, Card, Disclosure, Icon, Page, ui, type IconName } from '../ui/Kit';
import MockExplore from '../components/MockExplore';
import MissionTopTabs from '../components/MissionTopTabs';

type Tile = { id: string; title: string; detail: string; icon: IconName; status: string; action?: 'practice' | 'explore' };
const dim = '#BBAFC0';
function MissionGrid({ title, caption, items, onExplore }: { title: string; caption?: string; items: Tile[]; onExplore: () => void }) {
  const { width, fontScale } = useWindowDimensions();
  const { data, joinMission } = useLibrary();
  const [selected, setSelected] = useState<string | null>(null);
  const selectedItem = items.find(item => item.id === selected);
  const columns = width >= 340 && fontScale <= 1.25;
  return <View style={{ gap: 9 }}>
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}><Text style={{ color: '#FFF', fontSize: 19, fontFamily: 'SpaceGrotesk_500Medium' }}>{title}</Text>{!!caption && <Text style={{ color: dim, fontSize: 10, flexShrink: 1, textAlign: 'right' }}>{caption}</Text>}</View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{items.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ expanded: selected === item.id }} onPress={() => setSelected(selected === item.id ? null : item.id)} style={{ width: columns ? '48.7%' : '100%', minHeight: 100, padding: 13, borderRadius: 14, backgroundColor: selected === item.id ? '#493351' : C.missionSurface, gap: 9, justifyContent: 'space-between' }}><View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><Icon name={item.icon} size={19} color="#E195E4" /><Text style={{ color: '#C6B8CB', fontSize: 10 }}>{item.status}</Text></View><Text numberOfLines={2} style={{ color: '#FFF', fontSize: 14, lineHeight: 18, fontFamily: 'SpaceGrotesk_500Medium' }}>{item.title}</Text></Pressable>)}</View>
    {!!selectedItem && <View style={{ backgroundColor: '#392B40', borderRadius: 14, padding: 14, gap: 8 }}><Text style={{ color: '#FFF', fontSize: 14, fontFamily: 'SpaceGrotesk_600SemiBold' }}>{selectedItem.title}</Text><Text style={{ color: '#D3C9D5', fontSize: 12, lineHeight: 18 }}>{selectedItem.detail}</Text>{!!selectedItem.action && <Pressable accessibilityRole="button" onPress={() => { if (selectedItem.action === 'explore') { onExplore(); return; } joinMission(); const previous = data.sessions.find(s => s.missionId === selectedItem.id && s.missionWeek === weekKey() && !s.endedAt); if (previous) router.push({ pathname: '/session', params: { id: previous.id } }); else router.push({ pathname: '/new-session', params: { missionId: selectedItem.id, missionTitle: selectedItem.title } }); }} style={{ alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center' }}><Text style={{ color: '#F1A5EE', fontSize: 12, fontFamily: 'SpaceGrotesk_600SemiBold' }}>{selectedItem.action === 'explore' ? 'Open Explore →' : data.sessions.some(s => s.missionId === selectedItem.id && s.missionWeek === weekKey() && !s.endedAt) ? 'Resume practice →' : 'Start practice →'}</Text></Pressable>}</View>}
  </View>;
}
export default function Mission() {
  const { data, joinMission, updateExtras } = useLibrary();
  const [tab, setTab] = useState<'week' | 'month' | 'explore'>('week');
  const previousMissionTab = useRef<'week' | 'month'>('week');
  const changeTab = (next: 'week' | 'month' | 'explore') => { if (next !== 'explore') previousMissionTab.current = next; setTab(next); router.setParams({ view: next === 'explore' ? 'explore' : 'missions' }); };
  const goal = data.extras?.missionGoal ?? 3;
  const joined = data.joinedWeeks.includes(weekKey()), progress = missionProgress(data.sessions, weekKey(), goal);
  const now = new Date(), weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  weekStart.setDate(weekStart.getDate() - (weekStart.getDay() + 6) % 7);
  const lastWeekStart = new Date(weekStart); lastWeekStart.setDate(lastWeekStart.getDate() - 7);
  const lastWeek = data.sessions.filter(s => s.startedAt >= lastWeekStart.getTime() && s.startedAt < weekStart.getTime());
  const insights = trackingInsights(lastWeek.map(s => s.tracking));
  const partNames = { arm_l: 'left arm', arm_r: 'right arm', leg_l: 'left leg', leg_r: 'right leg' } as const;
  const parts = Object.keys(partNames) as (keyof typeof partNames)[];
  const observedParts = parts.filter(part => lastWeek.some(s => (s.tracking?.totals.observed[part] ?? 0) > 0));
  const cold = insights && observedParts.length ? [...observedParts].sort((a, b) => insights.segments[a] - insights.segments[b])[0] : null;
  const left = insights ? insights.segments.arm_l + insights.segments.leg_l : 0, right = insights ? insights.segments.arm_r + insights.segments.leg_r : 0;
  const mirror = !!insights && parts.every(part => observedParts.includes(part)) && left !== right;
  const weekly: Tile[] = [
    { id: 'cold', title: 'Wake a cold zone', detail: cold ? `Create an 8-count led by your ${partNames[cold]}, based on last week's tracked movement.` : 'Track a practice session this week to get a body-part suggestion next week.', icon: 'body-outline', status: cold ? 'Personalized' : 'Needs data', action: 'practice' },
    { id: 'space', title: 'Explore space', detail: 'Use at least three directions you did not use last week. Eight-direction tracking is not available yet.', icon: 'compass-outline', status: 'Coming soon' },
    { id: 'mirror', title: 'Mirror your movement', detail: mirror ? `Try a movement from your ${left > right ? 'left' : 'right'} side on your ${left > right ? 'right' : 'left'} side.` : 'Track both sides in a session to get a personal mirroring prompt next week.', icon: 'swap-horizontal-outline', status: mirror ? 'Personalized' : 'Needs data', action: 'practice' },
    { id: 'level', title: 'Change levels', detail: 'Create a routine using high, middle and low levels. Completion tracking is not available yet.', icon: 'resize-outline', status: 'Practice idea', action: 'practice' },
  ];
  const music: Tile[] = [
    { id: 'solo', title: 'Follow one layer', detail: 'Choose a project and use the mixer or watch to solo the drums or bass. Dance to that layer.', icon: 'musical-note-outline', status: 'Practice idea', action: 'practice' },
    { id: 'hidden', title: 'Find a hidden layer', detail: 'Create an 8-count to an instrument you do not usually follow. Personalized layer recommendations are not available yet.', icon: 'headset-outline', status: 'Practice idea', action: 'practice' },
    { id: 'switch', title: 'Switch layers', detail: 'Change the instrument you follow between sections using the phone or watch mixer.', icon: 'shuffle-outline', status: 'Practice idea', action: 'practice' },
  ];
  const discover: Tile[] = [
    { id: 'opposite', title: 'Find a new pattern', detail: 'Find and save three reference videos with a different movement pattern. Automatic heatmap matching is not available yet.', icon: 'search-outline', status: 'Explore', action: 'explore' },
    { id: 'remix', title: 'Make it your own', detail: 'Save a reference in Explore and reinterpret one movement in your own style.', icon: 'sparkles-outline', status: 'Explore', action: 'explore' },
    { id: 'relay', title: 'Relay choreography', detail: 'Continue the second half of a mission video and compare results. Recording and heatmap comparison for relay missions are not available yet.', icon: 'play-forward-outline', status: 'Coming soon' },
  ];
  if (tab === 'explore') return <MockExplore onMyMissions={() => changeTab(previousMissionTab.current)} />;
  return <View style={{ flex: 1, backgroundColor: C.missionBg }}><MissionTopTabs selected="missions" onChange={value => { if (value === 'explore') changeTab('explore'); }} /><Page>
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>{([['week', 'Weekly'], ['month', 'Monthly']] as const).map(([key, title]) => <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: tab === key }} onPress={() => changeTab(key)} style={{ minHeight: 40, paddingHorizontal: 18, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: tab === key ? '#FFF' : '#3A3040' }}><Text style={{ color: tab === key ? '#17121C' : '#D2C8D6', fontSize: 12, fontFamily: 'SpaceGrotesk_500Medium' }}>{title}</Text></Pressable>)}<Pressable accessibilityRole="button" accessibilityLabel="Mission history" onPress={() => router.push({ pathname: '/workspace', params: { tab: 'history' } })} style={{ marginLeft: 'auto', minHeight: 40, justifyContent: 'center' }}><Text style={{ color: '#D2C8D6', fontSize: 12 }}>History →</Text></Pressable></View>
    {tab === 'week' ? <>
      <View style={{ backgroundColor: '#493052', borderRadius: 16, padding: 16, gap: 10 }}><View style={ui.between}><View style={{ flex: 1 }}><Text style={{ color: '#E7C4EB', fontSize: 10, letterSpacing: 1, fontFamily: 'SpaceGrotesk_600SemiBold' }}>THIS WEEK · PRACTICE</Text><Text style={{ color: '#FFF', fontSize: 20, fontFamily: 'SpaceGrotesk_600SemiBold', marginTop: 4 }}>{progress} / {goal} sessions</Text></View><Pressable accessibilityRole="button" onPress={() => { if (!joined) joinMission(); else router.push(progress >= goal ? { pathname: '/workspace', params: { tab: 'history' } } : { pathname: '/new-session', params: { missionId: 'weekly', missionTitle: 'Weekly practice' } }); }} style={{ minHeight: 42, paddingHorizontal: 15, backgroundColor: '#FFF', borderRadius: 22, justifyContent: 'center' }}><Text style={{ color: '#241D2B', fontSize: 12, fontFamily: 'SpaceGrotesk_600SemiBold' }}>{!joined ? 'Join' : progress >= goal ? 'History' : 'Practice'}</Text></Pressable></View><View style={{ height: 4, backgroundColor: '#FFFFFF44', borderRadius: 4 }}><View style={{ height: 4, width: `${goal ? progress / goal * 100 : 0}%`, backgroundColor: '#F2A0EE', borderRadius: 4 }} /></View><Text style={{ color: '#D8C9DC', fontSize: 10 }}>Ended sessions played for at least 30 seconds count after joining.</Text></View>
      {!joined && <Disclosure dark title="Weekly goal" detail={`${goal} sessions`} icon="options-outline"><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{[1, 3, 5].map(n => <View key={n} style={{ flexGrow: 1 }}><Button title={`${n} sessions${goal === n ? ' ✓' : ''}`} secondary onPress={() => updateExtras(e => ({ ...e, missionGoal: n }))} /></View>)}</View></Disclosure>}
      {progress >= goal && <Card style={{ backgroundColor: C.missionSurface }}><Text style={[ui.h3, { color: '#FFF' }]}>Weekly badge</Text><Button title={data.extras?.badges.includes(weekKey()) ? 'Badge earned ✓' : 'Claim badge'} disabled={data.extras?.badges.includes(weekKey())} onPress={() => updateExtras(e => ({ ...e, badges: [...new Set([...e.badges, weekKey()])] }))} /></Card>}
      <MissionGrid title="For your movement" caption="Based on last week" items={weekly} onExplore={() => changeTab('explore')} />
      <MissionGrid title="Music digging" caption="Mixer · watch haptics" items={music} onExplore={() => changeTab('explore')} />
      <MissionGrid title="Explore & relay" items={discover} onExplore={() => changeTab('explore')} />
      <ServiceMission dark />
    </> : <>
      <View style={{ backgroundColor: '#493052', borderRadius: 16, padding: 18, gap: 8 }}><Text style={{ color: '#E7C4EB', fontSize: 10, letterSpacing: 1, fontFamily: 'SpaceGrotesk_600SemiBold' }}>MONTHLY CHALLENGE</Text><Text style={{ color: '#FFF', fontSize: 21, fontFamily: 'SpaceGrotesk_600SemiBold' }}>Move together</Text><Text style={{ color: '#E4D8E7', fontSize: 12, lineHeight: 19 }}>One shared theme, different interpretations.</Text><Text style={{ color: '#E7C4EB', fontSize: 11 }}>Community challenge · coming soon</Text></View>
      <MissionGrid title="At the end of the month" items={[{ id: 'compare', title: 'Compare heatmaps', detail: 'Compare your monthly movement with the community average. Community heatmap aggregation is not available yet.', icon: 'grid-outline', status: 'Coming soon' }, { id: 'relay', title: 'Relay choreography', detail: 'Continue a reference video and compare the completed movement and heatmaps. Relay comparison is not available yet.', icon: 'play-forward-outline', status: 'Coming soon' }]} onExplore={() => changeTab('explore')} />
    </>}
  </Page></View>;
}
