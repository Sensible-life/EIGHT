import { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Analysis, lastIndexAtOrBefore } from '../api';
import { C, sectionColor } from '../theme';

type Props = {
  a: Analysis;
  pos: number;
  loop: { start: number; end: number } | null;
  onSeek: (t: number) => void;
};

/** 곡 구조(section) + 8 count 눈금 + 재생 위치. 탭하면 가장 가까운 8 count 시작으로 이동 */
function Timeline({ a, pos, loop, onSeek }: Props) {
  const [w, setW] = useState(1);
  const x = (t: number) => (t / a.duration) * w;

  const onPress = (lx: number) => {
    const t = (lx / w) * a.duration;
    if (!a.eights.length) { onSeek(t); return; }
    const i = lastIndexAtOrBefore(a.eights, t, e => e.start);
    const e = a.eights[Math.max(0, i)];
    const next = a.eights[i + 1];
    onSeek(next && next.start - t < t - e.start ? next.start : e.start);
  };

  return (
    <Pressable onPress={ev => onPress(ev.nativeEvent.locationX)} onLayout={ev => setW(ev.nativeEvent.layout.width)}>
      <View style={s.track}>
        {a.sections.map((sec, i) => (
          <View
            key={i}
            style={[s.section, { left: x(sec.start), width: Math.max(1, x(sec.end) - x(sec.start)), backgroundColor: sectionColor(sec.label), opacity: 0.45 + 0.55 * sec.energy }]}
          >
            <Text style={s.sectionLabel}>{sec.label}</Text>
          </View>
        ))}
        {a.eights.map(e => (
          <View key={e.index + '-' + e.start} style={[s.tick, { left: x(e.start) }]} />
        ))}
        {loop && <View style={[s.loop, { left: x(loop.start), width: x(loop.end) - x(loop.start) }]} />}
        <View style={[s.head, { left: x(pos) - 1 }]} />
      </View>
    </Pressable>
  );
}

export default memo(Timeline);

const s = StyleSheet.create({
  track: { height: 44, backgroundColor: C.card, borderRadius: 8, overflow: 'hidden' },
  section: { position: 'absolute', top: 0, bottom: 0, borderRightWidth: 1, borderColor: C.bg, justifyContent: 'center', paddingLeft: 4 },
  sectionLabel: { color: '#fff', fontWeight: '800', fontSize: 12 },
  tick: { position: 'absolute', bottom: 0, width: 1, height: 8, backgroundColor: 'rgba(255,255,255,0.35)' },
  loop: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(217,242,139,0.15)', borderColor: C.accent, borderWidth: 1 },
  head: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: '#fff' },
});
