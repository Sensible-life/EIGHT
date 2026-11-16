import Slider from '@react-native-community/slider';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import type { Mix } from '../audio/mix';
import { C, STEM_LABELS } from '../theme';
import { Text } from '../ui/Typography';
import { Icon } from '../ui/Kit';

export default function CameraMixer({ mix, master, onLayer, onMaster }: { mix: Mix; master: number; onLayer: (stem: string, patch: Partial<Mix[string]>) => void; onMaster: (value: number) => void }) {
  const [open, setOpen] = useState(false), [selected, setSelected] = useState('master');
  const stems = Object.keys(mix), chosen = selected === 'master' || !mix[selected] ? null : selected;
  const layer = chosen ? mix[chosen] : null;
  const button = (label: string, active: boolean, onPress: () => void) => <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={{ minHeight: 36, paddingHorizontal: 12, borderRadius: 10, justifyContent: 'center', backgroundColor: active ? C.cardHi : C.bg }}><Text style={{ color: active ? C.accent : C.sub, fontSize: 11 }}>{label}</Text></Pressable>;
  return <View style={{ backgroundColor: C.card, borderRadius: 14, padding: 12, gap: 8, marginBottom: 12 }}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(value => !value)} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 34, gap: 8 }}><Icon name="musical-notes" size={18} color={C.accent} /><Text style={{ color: C.text, fontSize: 13, flex: 1 }}>Music controls</Text><Text style={{ color: C.sub, fontSize: 12 }}>{open ? 'Close −' : 'Open +'}</Text></Pressable>
    {open && <><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>{button('Master', !chosen, () => setSelected('master'))}{stems.map(stem => <View key={stem}>{button(STEM_LABELS[stem] ?? stem, chosen === stem, () => setSelected(stem))}</View>)}</ScrollView>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Text style={{ color: C.sub, fontSize: 11, minWidth: 38 }}>{Math.round((layer?.volume ?? master) * 100)}%</Text><Slider accessibilityLabel={chosen ? `${STEM_LABELS[chosen] ?? chosen} volume` : 'Master volume'} style={{ flex: 1, height: 40 }} minimumValue={0} maximumValue={chosen ? 1.5 : 1} step={.01} value={layer?.volume ?? master} onValueChange={value => chosen ? onLayer(chosen, { volume: value }) : onMaster(value)} minimumTrackTintColor={C.accent} maximumTrackTintColor={C.line} thumbTintColor={C.accent} /></View>
      {chosen && layer && <View style={{ flexDirection: 'row', gap: 6 }}>{button('Mute', layer.muted, () => onLayer(chosen, { muted: !layer.muted }))}{button('Solo', layer.solo, () => onLayer(chosen, { solo: !layer.solo }))}</View>}</>}
  </View>;
}
