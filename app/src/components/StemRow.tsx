import { Text } from '../ui/Typography';
import Slider from '@react-native-community/slider';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { C, STEM_LABELS, stemColor } from '../theme';
import Waveform from './Waveform';

type Props = {
  stem: string; index: number; volume: number; muted: boolean; solo: boolean; audible: boolean;
  level: number; waveform: number[]; progress: number;
  onVolume: (v: number) => void; onMute: () => void; onSolo: () => void;
};
function StemRow({ stem, index, volume, muted, solo, audible, level, waveform, progress, onVolume, onMute, onSolo }: Props) {
  const color = stemColor(stem), label = STEM_LABELS[stem] ?? stem;
  return <View style={s.card}>
    <View style={s.head}><View style={[s.icon, { backgroundColor: `${color}20` }]}><Text style={[s.number, { color }]}>{String(index + 1).padStart(2, '0')}</Text></View>
      <View style={s.title}><Text numberOfLines={1} style={s.name}>{label}</Text><Text numberOfLines={1} style={s.state}>{muted ? "Mute" : solo ? "Solo" : !audible ? "Another layer is soloed" : "Layer"}</Text></View>
      <Text style={[s.volume, { color: audible ? color : C.dim }]}>{Math.round(volume * 100)}<Text style={s.percent}>%</Text></Text>
    </View>
    <View style={s.waveRow}><View style={s.wave}>{waveform.length ? <Waveform values={waveform} color={color} progress={progress} muted={!audible} height={20} /> : <Text style={s.state}>Waveform unavailable</Text>}</View><View style={[s.level, { backgroundColor: audible && level * volume > .02 ? color : C.line }]} /></View>
    <Slider accessibilityLabel={`${label} volume`} accessibilityValue={{ min: 0, max: 150, now: Math.round(volume * 100) }} style={s.slider} minimumValue={0} maximumValue={1.5} step={0.01} value={volume} onValueChange={onVolume} minimumTrackTintColor={color} maximumTrackTintColor={C.line} thumbTintColor={color} />
    <View style={s.actions}><Pressable accessibilityRole="button" accessibilityLabel={`${label} mute`} accessibilityState={{ selected: muted }} onPress={onMute} style={[s.action, muted && s.muted]}><Text style={[s.actionText, muted && { color: C.err }]}>Mute</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label} solo`} accessibilityState={{ selected: solo }} onPress={onSolo} style={[s.action, solo && { backgroundColor: color }]}><Text style={[s.actionText, solo && { color: '#FFF' }]}>Solo</Text></Pressable></View>
  </View>;
}
export default memo(StemRow, (a, b) => a.stem === b.stem && a.index === b.index && a.volume === b.volume && a.muted === b.muted && a.solo === b.solo && a.audible === b.audible && a.waveform === b.waveform && Math.floor(a.progress * a.waveform.length) === Math.floor(b.progress * b.waveform.length) && (a.level * a.volume > .02) === (b.level * b.volume > .02));
const s = StyleSheet.create({
  card: { flex: 1, backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.line, padding: 12, minWidth: 0 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 }, icon: { width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }, number: { fontSize: 11, fontFamily: 'SpaceGrotesk_600SemiBold' }, title: { flex: 1, minWidth: 0 }, name: { color: C.text, fontSize: 14, fontFamily: 'SpaceGrotesk_600SemiBold' }, state: { color: C.dim, fontSize: 10, marginTop: 2 }, volume: { fontSize: 17, fontFamily: 'SpaceGrotesk_600SemiBold', fontVariant: ['tabular-nums'] }, percent: { fontSize: 10 },
  waveRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 10 }, wave: { flex: 1 }, level: { width: 6, height: 6, borderRadius: 3 }, slider: { height: 40, marginHorizontal: -5 }, actions: { flexDirection: 'row', gap: 6 }, action: { flex: 1, minHeight: 44, borderRadius: 10, backgroundColor: C.cardHi, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }, actionText: { color: C.sub, fontSize: 11, fontFamily: 'SpaceGrotesk_600SemiBold' }, muted: { backgroundColor: '#FCE9ED' },
});
