import { useState, type PropsWithChildren } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import { C } from '../theme';
import { Icon, type IconName, ui } from './Kit';
import { Text } from './Typography';

export function ScreenTabs<T extends string>({ items, value, onChange }: { items: readonly (readonly [T, string])[]; value: T; onChange: (value: T) => void }) {
  return <View accessibilityRole="tablist" style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: C.line }}>{items.map(([key, title]) => <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: value === key }} onPress={() => onChange(key)} style={{ flex: 1, minWidth: 0, minHeight: 48, justifyContent: 'center', alignItems: 'center', borderBottomWidth: 2, borderBottomColor: value === key ? C.accent : 'transparent', marginBottom: -1 }}><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ textAlign: 'center', color: value === key ? C.accent : C.sub, fontSize: 12, fontFamily: value === key ? 'SpaceGrotesk_600SemiBold' : 'SpaceGrotesk_500Medium' }}>{title}</Text></Pressable>)}</View>;
}

export function SectionTitle({ title, detail }: { title: string; detail?: string }) {
  return <View style={{ gap: 3, marginTop: 6 }}><Text style={{ color: C.text, fontSize: 20, lineHeight: 26, letterSpacing: -.5, fontFamily: 'SpaceGrotesk_500Medium' }}>{title}</Text>{!!detail && <Text style={ui.small}>{detail}</Text>}</View>;
}

export function SettingsItem({ title, detail, icon, children, initiallyOpen = false, style }: PropsWithChildren<{ title: string; detail: string; icon: IconName; initiallyOpen?: boolean; style?: ViewStyle }>) {
  const [open, setOpen] = useState(initiallyOpen);
  return <View style={[{ backgroundColor: C.card, borderRadius: 14, overflow: 'hidden' }, style]}><Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 72, paddingHorizontal: 14, paddingVertical: 12 }}><View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: C.cardHi, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={20} color={C.accent} /></View><View style={{ flex: 1, minWidth: 0, gap: 2 }}><Text style={ui.h3}>{title}</Text><Text style={ui.small}>{detail}</Text></View><Icon name={open ? 'chevron-up' : 'chevron-down'} color={C.dim} size={18} /></Pressable>{open && <View style={{ paddingHorizontal: 14, paddingBottom: 16, paddingTop: 4, gap: 10 }}>{children}</View>}</View>;
}
