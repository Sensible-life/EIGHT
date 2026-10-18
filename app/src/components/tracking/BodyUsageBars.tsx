import { StyleSheet, Text, View } from 'react-native';
import { SEGMENT_LABELS } from '../../tracking/phrases';
import { SEGMENT_NAMES } from '../../tracking/segments';
import type { Segment } from '../../tracking/types';
import { C } from '../../theme';

type Props = { segments: Record<Segment, number>; underused: Segment[]; dim?: boolean };

/** Share of movement per body part. Quiet parts read "안 가본 쪽" with a dashed track, never as a warning. */
export default function BodyUsageBars({ segments, underused, dim = false }: Props) {
  return (
    <View style={[s.list, dim && s.dim]}>
      {SEGMENT_NAMES.map(seg => {
        const quiet = underused.includes(seg), pct = Math.round(segments[seg] * 100);
        return (
          <View key={seg} style={s.row}>
            <Text style={s.label}>{SEGMENT_LABELS[seg]}</Text>
            <View style={[s.track, quiet && s.quietTrack]}><View style={[s.fill, { width: `${pct}%` }]} /></View>
            <Text style={[s.value, quiet && s.quietValue]}>{quiet ? '안 가본 쪽' : `${pct}%`}</Text>
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  list: { gap: 8 },
  dim: { opacity: 0.45 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: { width: 52, color: C.sub, fontSize: 12 },
  track: { flex: 1, height: 9, borderRadius: 5, backgroundColor: C.bg, overflow: 'hidden' },
  quietTrack: { borderWidth: 1, borderStyle: 'dashed', borderColor: C.accent, backgroundColor: 'transparent' },
  fill: { height: '100%', borderRadius: 5, backgroundColor: C.accent },
  value: { width: 64, textAlign: 'right', color: C.text, fontSize: 12, fontVariant: ['tabular-nums'] },
  quietValue: { color: C.accent, fontSize: 11 },
});
