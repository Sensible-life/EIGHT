import { Slot, router, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { LibraryProvider, useLibrary } from '../state/LibraryProvider';
import { C } from '../theme';
import { Icon, IconName } from '../ui/Kit';
const tabs: { path: '/' | '/workspace' | '/new-session' | '/analysis' | '/mission'; label: string; icon: IconName }[] = [
  { path: '/', label: '홈', icon: 'home-outline' }, { path: '/workspace', label: '워크스페이스', icon: 'albums-outline' }, { path: '/new-session', label: '새로운 시작', icon: 'add' }, { path: '/analysis', label: '분석', icon: 'stats-chart-outline' }, { path: '/mission', label: '미션', icon: 'flag-outline' },
];
function Shell() {
  const path = usePathname(); const { ready, storageError } = useLibrary();
  return <SafeAreaView style={s.safe}><StatusBar style="dark" /><View style={s.shell}>
    <View style={s.header}><Pressable accessibilityRole="button" accessibilityLabel="홈" onPress={() => router.replace('/')} style={s.brand}><Icon name="pulse" color={C.accent} size={23} /><Text style={s.word}>Choreo<Text style={{ fontWeight: '400' }}>Layer</Text></Text><View style={s.dot} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel="연결 설정" onPress={() => router.push('/settings')} style={s.settings}><Icon name="options-outline" size={20} /></Pressable></View>
    {!!storageError && <Text style={s.warning}>{storageError}</Text>}
    <View style={{ flex: 1 }}>{ready ? <Slot /> : <ActivityIndicator color={C.accent} style={{ flex: 1 }} />}</View>
    {path !== '/session' && <View style={s.nav}>{tabs.map(t => <Pressable key={t.path} accessibilityRole="button" accessibilityLabel={t.label} accessibilityState={{ selected: path === t.path }} onPress={() => router.replace(t.path)} style={s.tab}>{t.path === '/new-session' ? <View style={s.new}><Icon name="add" color="#FFF" size={32} /></View> : <Icon name={t.icon} color={path === t.path ? C.accent : C.dim} size={22} />}<Text style={[s.navText, path === t.path && { color: C.accent, fontWeight: '700' }]}>{t.label}</Text>{path === t.path && t.path !== '/new-session' && <View style={s.activeDot} />}</Pressable>)}</View>}
  </View></SafeAreaView>;
}
export default function Layout() { return <SafeAreaProvider><LibraryProvider><Shell /></LibraryProvider></SafeAreaProvider>; }
const s = StyleSheet.create({ safe: { flex: 1, backgroundColor: C.bg }, shell: { flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center', backgroundColor: C.bg }, header: { height: 66, paddingHorizontal: 24, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, brand: { flexDirection: 'row', gap: 7, alignItems: 'center' }, word: { color: C.text, fontWeight: '800', fontSize: 19, letterSpacing: -.6 }, dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: C.accent, marginLeft: 3 }, settings: { width: 42, height: 42, borderRadius: 22, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' }, nav: { flexDirection: 'row', marginHorizontal: 14, marginBottom: 8, borderRadius: 28, backgroundColor: C.card, minHeight: 82, borderWidth: 1, borderColor: C.line }, tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 7, minHeight: 80 }, navText: { fontSize: 9, color: C.dim }, new: { marginTop: -26, width: 62, height: 62, borderRadius: 24, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 5, borderColor: C.bg, boxShadow: '0px 6px 16px rgba(178,11,194,0.18)' }, activeDot: { width: 4, height: 4, borderRadius: 3, backgroundColor: C.accent, position: 'absolute', bottom: 8 }, warning: { padding: 10, color: C.err, fontSize: 11 } });
