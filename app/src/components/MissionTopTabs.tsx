import { Pressable, View } from 'react-native';
import { Text } from '../ui/Typography';

export default function MissionTopTabs({ selected, onChange }: { selected: 'missions' | 'explore'; onChange: (value: 'missions' | 'explore') => void }) {
  return <View accessibilityRole="tablist" style={{ height: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
    {([['missions', 'My missions'], ['explore', 'Explore']] as const).map(([key, title]) => <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: selected === key }} onPress={() => onChange(key)} style={{ minHeight: 48, justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: selected === key ? '#FFF' : 'transparent' }}><Text style={{ color: selected === key ? '#FFF' : '#FFFFFFA8', fontSize: 15, fontFamily: selected === key ? 'SpaceGrotesk_600SemiBold' : 'SpaceGrotesk_500Medium' }}>{title}</Text></Pressable>)}
  </View>;
}
