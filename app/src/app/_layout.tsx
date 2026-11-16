import { Text } from '../ui/Typography';
import { SpaceGrotesk_300Light } from '@expo-google-fonts/space-grotesk/300Light';
import { SpaceGrotesk_500Medium } from '@expo-google-fonts/space-grotesk/500Medium';
import { SpaceGrotesk_600SemiBold } from '@expo-google-fonts/space-grotesk/600SemiBold';
import { useFonts } from 'expo-font';
import { router, useFocusEffect, usePathname } from 'expo-router';
import { Stack, type StackCardInterpolationProps, type StackNavigationOptions } from 'expo-router/js-stack';
import { StatusBar } from 'expo-status-bar';
import { createContext, memo, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { AccessibilityInfo, ActivityIndicator, Animated, Easing, Image, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { LibraryProvider, useLibrary } from '../state/LibraryProvider';
import { ServiceProvider } from '../service/ServiceProvider';
import { DeviceProvider } from '../state/DeviceProvider';
import { C } from '../theme';
import { Icon, IconName } from '../ui/Kit';
import BrandLogo from '../ui/BrandLogo';
import { homeHorizontalInset } from '../ui/homeLayout';
const tabs: { path: '/' | '/workspace' | '/new-session' | '/analysis' | '/mission'; label: string; icon: IconName }[] = [
  { path: '/', label: 'Home', icon: 'home-outline' }, { path: '/workspace', label: 'Workspace', icon: 'grid-outline' }, { path: '/new-session', label: "New session", icon: 'add' }, { path: '/analysis', label: 'Analysis', icon: 'analytics-outline' }, { path: '/mission', label: 'Missions', icon: 'flag-outline' },
];
const transition = {
  open: { animation: 'timing' as const, config: { duration: 220, easing: Easing.in(Easing.quad) } },
  close: { animation: 'timing' as const, config: { duration: 260, easing: Easing.out(Easing.quad) } },
};
const slideCard = ({ current, next, layouts, index }: StackCardInterpolationProps) => ({
  cardStyle: { transform: [{ translateX: Animated.add(
    index === 0 ? 0 : current.progress.interpolate({ inputRange: [0, 1], outputRange: [layouts.screen.width, 0], extrapolate: 'clamp' }),
    next ? next.progress.interpolate({ inputRange: [0, 1], outputRange: [0, -layouts.screen.width * .23], extrapolate: 'clamp' }) : 0,
  ) }] },
});
const TabNavigation = createContext<RefObject<((path: string) => void) | null> | null>(null);
function Shell({ path, id, immersive, canGoBack, onBack, onSelectTab, children }: { path: string; id?: string; immersive?: boolean; canGoBack: boolean; onBack: () => void; onSelectTab: (path: string) => void; children: ReactNode }) {
  const { ready, storageError, data } = useLibrary();
  const tabNavigationRef = useContext(TabNavigation);
  useFocusEffect(useCallback(() => {
    if (tabNavigationRef) tabNavigationRef.current = onSelectTab;
    return () => { if (tabNavigationRef?.current === onSelectTab) tabNavigationRef.current = null; };
  }, [onSelectTab, tabNavigationRef]));
  const { width } = useWindowDimensions();
  const homeScale = Math.min(width, 560) / 402;
  const projectName = data.projects.find(project => project.id === id)?.job.name.replace(/\.[^.]+$/, '');
  const headers: Record<string, { title: string; caption: string }> = {
    '/workspace': { title: 'Workspace', caption: 'YOUR PROJECTS' },
    '/analysis': { title: 'Practice insights', caption: 'RHYTHM INSIGHTS' },
    '/mission': { title: 'Missions', caption: 'MAKE YOUR MOVE' },
    '/new-session': { title: 'Start a session', caption: 'NEW SESSION' },
    '/project': { title: projectName ?? 'Project', caption: 'MY PROJECT' },
    '/editor': { title: 'Choreography', caption: projectName?.toUpperCase() ?? 'MY PROJECT' },
    '/motion': { title: 'Motion studio', caption: 'BODY · SPACE · RHYTHM' },
    '/settings': { title: 'Settings', caption: 'DEVICES & APP' },
    '/community': { title: 'Community', caption: 'EXPLORE' },
  };
  const pageHeader = headers[path];
  const bell = <Pressable accessibilityRole="button" accessibilityLabel="Settings" onPress={() => router.push('/settings')} style={[s.settings, { paddingBottom: 17.5 * homeScale }]}><Icon name="settings-outline" color="#111" size={25 * homeScale} /></Pressable>;
  return <View style={s.screen}>
    {path === '/' && <View style={[s.header, { paddingHorizontal: homeHorizontalInset(width) }]}><Pressable accessibilityRole="button" accessibilityLabel={"Home"} onPress={() => router.replace('/')} style={[s.brand, { alignSelf: 'stretch', justifyContent: 'flex-end', paddingBottom: homeHorizontalInset(width) / 2 }]}><BrandLogo width={75 * homeScale} /></Pressable>{bell}</View>}
    {!!pageHeader && !immersive && <View style={[s.pageHeader, { paddingHorizontal: homeHorizontalInset(width) }]}>{canGoBack && <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={onBack} hitSlop={10} style={[s.back, { marginLeft: -6 * homeScale, marginRight: 12 + 6 * homeScale }]}><Icon name="arrow-back" size={24} color={C.text} /></Pressable>}<View style={s.pageHeading}><Text numberOfLines={1} style={s.pageCaption}>{pageHeader.caption}</Text><Text accessibilityRole="header" numberOfLines={1} style={[s.pageTitle, path === '/project' && s.projectTitle]}>{pageHeader.title}</Text></View>{path === '/mission' && <Pressable accessibilityRole="button" accessibilityLabel="Mission history" onPress={() => router.push({ pathname: '/workspace', params: { tab: 'history' } })} style={s.headerAction}><Image source={require('../../assets/figma/mission-history.png')} style={{ width: 24, height: 24 }} /></Pressable>}{bell}</View>}
    {!!storageError && <Text style={s.warning}>{storageError}</Text>}
    <View style={{ flex: 1, backgroundColor: immersive ? C.missionBg : path === '/' ? '#FFF' : C.bg }}>{ready ? children : <ActivityIndicator color={C.accent} style={{ flex: 1 }} />}</View>
  </View>;
}
function NavigationBar({ path, onSelectTab }: { path: string; onSelectTab: (path: string) => void }) {
  const dark = path === '/mission';
  return <View style={[s.nav, dark && { backgroundColor: C.missionBg, borderTopColor: '#382B3F' }]}>{tabs.map(t => <Pressable key={t.path} accessibilityRole="button" accessibilityLabel={t.label} accessibilityState={{ selected: path === t.path }} onPress={() => { if (path !== t.path) onSelectTab(t.path); }} style={s.tab}>{t.path === '/new-session' ? <View style={s.new}><Svg width={68} height={68} viewBox="0 0 68 68" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Defs><LinearGradient id="newSessionGradient" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#C329DD" /><Stop offset="0.5" stopColor="#9D2FDA" /><Stop offset="1" stopColor="#4439D5" /></LinearGradient></Defs><Circle cx={34} cy={34} r={33.5} fill="url(#newSessionGradient)" stroke="#FFFFFF" strokeOpacity={0.25} /><Path d="M34 25v18M25 34h18" fill="none" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" /></Svg></View> : <Icon name={t.icon} color={dark ? (path === t.path ? C.missionNavActive : C.missionNavMuted) : (path === t.path ? '#DC16DF' : '#ACB4B2')} size={20} />}{t.path !== '/new-session' && <Text numberOfLines={1} adjustsFontSizeToFit style={[s.navText, dark && { color: C.missionNavMuted }, path === t.path && { color: dark ? C.missionNavActive : '#DC16DF' }]}>{t.label}</Text>}</Pressable>)}</View>;
}
export default function Layout() {
  const [loaded, error] = useFonts({ SpaceGrotesk_300Light, SpaceGrotesk_500Medium, SpaceGrotesk_600SemiBold });
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (active) setReduceMotion(value); }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { active = false; subscription.remove(); };
  }, []);
  const options = useCallback((tabSwitch: boolean): StackNavigationOptions => ({ headerShown: false, animation: reduceMotion || tabSwitch ? 'none' : 'default', detachPreviousScreen: false, cardOverlayEnabled: false, cardShadowEnabled: false, ...(reduceMotion || tabSwitch ? {} : { gestureDirection: 'horizontal', transitionSpec: transition, cardStyleInterpolator: slideCard }) }), [reduceMotion]);
  if (!loaded && !error) return null;
  return <SafeAreaProvider><LibraryProvider><ServiceProvider><DeviceProvider><Frame options={options} /></DeviceProvider></ServiceProvider></LibraryProvider></SafeAreaProvider>;
}
function Frame({ options }: { options: (tabSwitch: boolean) => StackNavigationOptions }) {
  const path = usePathname();
    const immersive = path === '/mission';
  const tabNavigation = useRef<((path: string) => void) | null>(null);
  return <TabNavigation.Provider value={tabNavigation}><SafeAreaView style={[s.safe, immersive && { backgroundColor: C.missionBg }]}><StatusBar style={immersive ? "light" : "dark"} /><View style={s.shell}>
    <View style={s.stack}><ScreenStack options={options} /></View>
    {path !== '/session' && <NavigationBar path={path} onSelectTab={target => tabNavigation.current?.(target)} />}
  </View></SafeAreaView></TabNavigation.Provider>;
}
const ScreenStack = memo(function ScreenStack({ options }: { options: (tabSwitch: boolean) => StackNavigationOptions }) {
  const screenOptions = useCallback<Extract<NonNullable<React.ComponentProps<typeof Stack>['screenOptions']>, (...args: never[]) => unknown>>(({ route }) => options((route.params as { _tabSwitch?: string } | undefined)?._tabSwitch === '1'), [options]);
  const screenLayout = useCallback<NonNullable<React.ComponentProps<typeof Stack>['screenLayout']>>(function renderScreen({ route, navigation, children }) {
      const index = navigation.getState().routes.findIndex(screen => screen.key === route.key);
      const params = route.params as { id?: string; view?: string } | undefined;
      return <Shell path={route.name === 'index' ? '/' : `/${route.name}`} id={params?.id} immersive={route.name === 'mission'} canGoBack={index > 0} onBack={() => navigation.goBack()} onSelectTab={target => navigation.reset({ index: 0, routes: [{ name: target === '/' ? 'index' : target.slice(1), params: { _tabSwitch: '1' } }] })}>{children}</Shell>;
  }, []);
  return <Stack screenOptions={screenOptions} screenLayout={screenLayout} />;
});
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFF' }, shell: { flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center', backgroundColor: '#FFF' }, stack: { flex: 1 }, screen: { flex: 1, backgroundColor: '#FFF' },
  header: { height: 70, paddingHorizontal: 32, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, brand: { minHeight: 44, justifyContent: 'center' },
  pageHeader: { minHeight: 70, flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF' }, pageHeading: { flex: 1, minWidth: 0, gap: 3, paddingVertical: 8 }, pageCaption: { color: C.dim, fontSize: 9, letterSpacing: 1.6, fontFamily: 'SpaceGrotesk_600SemiBold' }, pageTitle: { color: C.text, fontSize: 22, lineHeight: 28, fontFamily: 'SpaceGrotesk_600SemiBold' }, headerAction: { width: 40, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  projectTitle: { fontSize: 18, lineHeight: 23 },
  back: { width: 24, minHeight: 44, marginRight: 12, alignItems: 'center', justifyContent: 'center' },
  settings: { width: 42, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'flex-end' }, nav: { flexDirection: 'row', minHeight: 70, backgroundColor: '#FFF', borderTopWidth: 1, borderTopColor: '#E3E8E6' }, tab: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', gap: 5, minHeight: 70 },
  navText: { fontSize: 11, color: '#ACB4B2', textAlign: 'center' }, new: { marginTop: -25, transform: [{ translateY: -10 }], width: 68, height: 68, borderRadius: 34, backgroundColor: '#8F31D9', alignItems: 'center', justifyContent: 'center', shadowColor: '#6533B8', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.15, shadowRadius: 7, elevation: 3 }, warning: { padding: 10, color: C.err, fontSize: 11 },
});
