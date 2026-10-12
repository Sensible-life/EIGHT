import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

type Props = { values: number[]; color: string; progress?: number; height?: number; muted?: boolean };

function Waveform({ values, color, progress = 0, height = 36, muted = false }: Props) {
  const peak = Math.max(0.05, ...values);
  return (
    <View style={[s.wave, { height, opacity: muted ? 0.25 : 1 }]} accessible={false}>
      {values.map((value, i) => (
        <View key={i} style={{ flex: 1, borderRadius: 2, height: Math.max(2, (value / peak) * height),
          backgroundColor: color, opacity: i / values.length <= progress ? 1 : 0.3 }} />
      ))}
    </View>
  );
}

const s = StyleSheet.create({ wave: { flexDirection: 'row', gap: 2, alignItems: 'center', overflow: 'hidden' } });
export default memo(Waveform);
