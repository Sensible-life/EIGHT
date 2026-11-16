import { Text } from '../ui/Typography';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop, SvgXml } from 'react-native-svg';
import { useLibrary } from '../state/LibraryProvider';
import { missionProgress, weekKey } from '../state/model';
import { Icon } from '../ui/Kit';
import { missionLogoSvg } from '../ui/missionLogo';
import { homeHorizontalInset } from '../ui/homeLayout';

export default function Home() {
  const { width, fontScale } = useWindowDimensions();
  const [bannerSize, setBannerSize] = useState({ width: 0, height: 0 });
  const { data, choose } = useLibrary();
  const recent = [...data.sessions].sort((a, b) => b.startedAt - a.startedAt).find(s => data.projects.some(p => p.id === s.projectId));
  const recentVideo = [...(data.extras?.motifs ?? [])].filter(m => m.video && data.projects.some(p => p.id === m.projectId)).sort((a, b) => b.createdAt - a.createdAt)[0];
  const project = data.projects.find(p => p.id === (recentVideo?.projectId ?? recent?.projectId)) ?? data.projects[0];
  const goal = data.extras?.missionGoal ?? 3;
  const progress = missionProgress(data.sessions, weekKey(), goal);
  const joined = data.joinedWeeks.includes(weekKey());
  const minutes = Math.floor(data.sessions.reduce((sum, s) => sum + s.listened, 0) / 60);
  const completed = new Set((data.extras?.finished ?? []).map(item => item.projectId)).size;
  const compact = width < 350 || fontScale > 1.2;
  const horizontalInset = homeHorizontalInset(width);

  const resume = () => { if (!project) { router.push('/new-session'); return; } choose(project.id); router.push({ pathname: '/project', params: { id: project.id } }); };
  return <ScrollView style={s.page} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Weekly mission, ${joined ? `${progress} / ${goal} completed` : "Join"}`} onPress={() => router.push('/mission')} onLayout={({ nativeEvent: { layout } }) => setBannerSize(size => size.width === layout.width && size.height === layout.height ? size : { width: layout.width, height: layout.height })} style={[s.banner, { paddingHorizontal: horizontalInset }]}>
      {bannerSize.width > 0 && bannerSize.height > 0 && <Svg style={StyleSheet.absoluteFill} width={bannerSize.width} height={bannerSize.height}><Defs><LinearGradient id="homeGradient" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#F02CEC" /><Stop offset="0.5" stopColor="#D12BE6" /><Stop offset="1" stopColor="#3339D4" /></LinearGradient></Defs><Rect width={bannerSize.width} height={bannerSize.height} fill="url(#homeGradient)" /></Svg>}
      <View style={s.bannerCopy}><Text style={s.eyebrow}>WEEKLY MISSION</Text><Text style={s.bannerTitle}>Explore a New{'\n'}Movement Level</Text></View>
      <View style={[s.art, compact && s.compactArt, { right: horizontalInset }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><SvgXml xml={missionLogoSvg} width="100%" height="100%" /></View>
      <View style={s.bannerBottom}><View style={[s.steps, compact && s.compactSteps]}>{Array.from({ length: goal }, (_, i) => <View key={i} style={s.step}><View style={[s.stepCircle, compact && s.compactStepCircle, i < progress && s.stepDone]}>{i < progress && <Icon name="checkmark" color="#EA33E7" size={23} />}</View><Text style={s.stepNumber}>{i + 1}</Text></View>)}</View><View style={s.continue}><Text style={s.continueText}>{joined ? "Continue" : "Join"}</Text><Icon name="chevron-forward" color="#141414" size={16} /></View></View>
    </Pressable>
    <View style={[s.sections, { paddingHorizontal: horizontalInset }]}>
      <Text style={s.heading}>Recommendation</Text>
      <Pressable accessibilityRole="button" onPress={resume} style={s.recommendation}><View style={{ flex: 1 }}><Text style={s.cardTitle}>{project ? project.job.name.replace(/\.[^.]+$/, '') : "No recent project"}</Text><Text style={s.cardDetail}>{project ? "Recent project" : "Choose music to start"}</Text></View><Icon name="chevron-forward" size={18} color="#A758AB" /></Pressable>
      <Text style={[s.heading, { marginTop: 18 }]}>Insights Preview</Text>
      <View style={s.insights}><Pressable accessibilityRole="button" accessibilityLabel={`Total listening: ${minutes} minutes, view insights`} onPress={() => router.push('/analysis')} style={s.insightCard}><Icon name="time-outline" size={21} color="#BE25C7" /><Text style={s.metric}>{minutes}<Text style={s.metricUnit}> min</Text></Text><Text style={s.cardDetail}>Total listening time</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Completed projects: ${completed}, view insights`} onPress={() => router.push('/analysis')} style={s.insightCard}><Icon name="checkmark-done-outline" size={21} color="#BE25C7" /><Text style={s.metric}>{completed}</Text><Text style={s.cardDetail}>Completed projects</Text></Pressable></View>
    </View>
  </ScrollView>;
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#FFF' }, content: { paddingBottom: 32 },
  banner: { width: '100%', backgroundColor: '#D12BE6', minHeight: 213, paddingTop: 18, paddingBottom: 16, justifyContent: 'space-between', overflow: 'hidden' },
  bannerCopy: { maxWidth: '65%', gap: 10 }, eyebrow: { color: '#FFF', fontSize: 12, fontFamily: 'SpaceGrotesk_300Light' }, bannerTitle: { color: '#FFF', fontSize: 22, lineHeight: 29, fontFamily: 'SpaceGrotesk_600SemiBold' },
  art: { position: 'absolute', top: 15, width: 141, height: 127 }, compactArt: { width: 80, height: 72 }, bannerBottom: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 },
  steps: { flexDirection: 'row', flexShrink: 1, gap: 12 }, compactSteps: { gap: 5 }, step: { alignItems: 'center', gap: 2 }, stepCircle: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderStyle: 'dotted', borderColor: '#FFF', alignItems: 'center', justifyContent: 'center' }, compactStepCircle: { width: 24, height: 24, borderRadius: 12 }, stepDone: { borderStyle: 'solid', backgroundColor: '#FFF' }, stepNumber: { color: '#FFF', fontSize: 8 },
  continue: { backgroundColor: '#FFF', borderRadius: 20, minHeight: 34, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 5 }, continueText: { color: '#111', fontSize: 13, fontFamily: 'SpaceGrotesk_600SemiBold' },
  sections: { paddingTop: 33 }, heading: { color: '#111', fontSize: 20, marginBottom: 17 }, recommendation: { minHeight: 84, borderRadius: 12, backgroundColor: '#FAE9FA', paddingHorizontal: 18, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', gap: 10 }, cardTitle: { color: '#422F45', fontSize: 14, fontFamily: 'SpaceGrotesk_600SemiBold' }, cardDetail: { color: '#8E7890', fontSize: 12, marginTop: 5 },
  insights: { flexDirection: 'row', gap: 16 }, insightCard: { flex: 1, minWidth: 0, minHeight: 162, borderRadius: 12, backgroundColor: '#FAE9FA', padding: 18, justifyContent: 'center' }, metric: { color: '#4F3152', fontSize: 28, fontFamily: 'SpaceGrotesk_600SemiBold', marginTop: 12 }, metricUnit: { fontSize: 15 },
});
