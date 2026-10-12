import Slider from '@react-native-community/slider';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { C, STEM_LABELS, stemColor } from '../theme';
import Waveform from './Waveform';

type Props = {
  stem: string; index: number; volume: number; muted: boolean; solo: boolean; audible: boolean;
  level: number; waveform: number[]; progress: number;
  onVolume: (v: number) => void; onMute: () => void; onSolo: () => void;
};
function StemRow({ stem, index, volume, muted, solo, audible, level, waveform, progress, onVolume, onMute, onSolo }: Props) {
  const color = stemColor(stem), label = STEM_LABELS[stem] ?? stem;
  return (
    <View style={[s.card, { borderLeftColor: color }]}>
      <View style={s.head}>
        <View style={[s.number, { backgroundColor: color + '18' }]}><Text style={[s.numberText, { color }]}>{String(index + 1).padStart(2, '0')}</Text></View>
        <View style={s.titleBlock}><Text style={s.name}>{label}</Text><Text style={s.state}>{muted ? '음소거 중' : solo ? '솔로 재생' : !audible ? '다른 레이어 솔로 중' : 'LAYER'}</Text></View>
        <Text style={[s.volume, { color: audible ? color : C.dim }]}>{Math.round(volume * 100)}<Text style={s.percent}>%</Text></Text>
      </View>
      <View style={s.waveRow}>
        <View style={s.wave}><Waveform values={waveform} color={color} progress={progress} muted={!audible} height={28} /></View>
        <View style={s.meter}>{Array.from({ length: 8 }, (_, i) => <View key={i} style={[s.meterSegment, { backgroundColor: audible && level * volume > i / 8 ? color : C.line }]} />)}</View>
      </View>
      <Slider accessibilityLabel={`${label} 볼륨`} accessibilityValue={{ min: 0, max: 150, now: Math.round(volume * 100) }} style={s.slider} minimumValue={0} maximumValue={1.5} step={0.01} value={volume} onValueChange={onVolume} minimumTrackTintColor={color} maximumTrackTintColor={C.line} thumbTintColor={color} />
      <View style={s.footer}>
        <Text style={s.scale}>0 ───────── 100 ─── 150%</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`${label} 음소거`} accessibilityState={{ selected: muted }} onPress={onMute} style={[s.button, muted && s.muted]}><Text style={[s.buttonText, muted && { color: C.err }]}>음소거</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`${label} 솔로`} accessibilityState={{ selected: solo }} onPress={onSolo} style={[s.button, solo && { backgroundColor: color }]}><Text style={[s.buttonText, solo && { color: C.bg }]}>솔로</Text></Pressable>
      </View>
    </View>
  );
}
export default memo(StemRow);
const s = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.line, borderLeftWidth: 3, padding: 16, marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 }, number: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, numberText: { fontSize: 13, fontWeight: '700' }, titleBlock: { flex: 1 },
  name: { color: C.text, fontSize: 17, fontWeight: '700' }, state: { color: C.dim, fontSize: 9, letterSpacing: 1.5, marginTop: 3 }, volume: { fontSize: 28, fontWeight: '600', fontVariant: ['tabular-nums'] }, percent: { fontSize: 12, fontWeight: '400' },
  waveRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 14 }, wave: { flex: 1 }, meter: { flexDirection: 'row', gap: 2 }, meterSegment: { width: 3, height: 14, borderRadius: 1 },
  slider: { height: 36, marginHorizontal: -3 }, footer: { flexDirection: 'row', alignItems: 'center', gap: 6 }, scale: { color: C.dim, flex: 1, fontSize: 9 }, button: { minHeight: 32, paddingHorizontal: 12, borderRadius: 8, backgroundColor: C.cardHi, alignItems: 'center', justifyContent: 'center' }, buttonText: { color: C.sub, fontSize: 11, fontWeight: '600' }, muted: { backgroundColor: '#FCE9ED' },
});
