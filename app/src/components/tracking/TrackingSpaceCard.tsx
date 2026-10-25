import { StyleSheet, Text, View } from 'react-native';
import type { Session } from '../../state/model';
import { moveInsights } from '../../tracking/insights';
import { C } from '../../theme';
import { Card, Icon, ui } from '../../ui/Kit';

const ROWS = ['높음', '중간', '낮음'], COLS = ['왼쪽', '가운데', '오른쪽'];
const USED_SHARE = 0.03; // a cell counts as used from 3% of the time

/** Analysis tab: where the dancer was, from the spot they calibrated on. Left / right = the dancer's own. */
export default function TrackingSpaceCard({ sessions }: { sessions: Session[] }) {
  const insight = moveInsights(sessions.map(s => s.tracking));
  if (!insight) return (
    <Card>
      <Icon name="grid-outline" color={C.dim} size={28} />
      <Text style={ui.h3}>카메라로 본 공간</Text>
      <Text style={ui.body}>세션의 카메라 탭에서 춤추면 점프·앉기·옆 이동·기울이기와 머문 자리를 보여줘요.</Text>
    </Card>
  );
  const m = insight.moves, sum = m.spaceMs.reduce((a, b) => a + b, 0);
  const share = (i: number) => (sum ? m.spaceMs[i] / sum : 0);
  const used = m.spaceMs.filter((_, i) => share(i) >= USED_SHARE).length;
  const counts = [
    `점프 ${m.jump}번`, `앉기 ${m.low}번`, `옆 이동 왼쪽 ${m.travel.l} · 오른쪽 ${m.travel.r}`, `기울이기 왼쪽 ${m.lean.l} · 오른쪽 ${m.lean.r}`,
  ];
  return (
    <Card>
      <View style={ui.between}>
        <Text style={ui.h3}>카메라로 본 공간</Text>
        <Text style={ui.pill}>쓴 칸 {used} / 9</Text>
      </View>
      <View style={s.grid}>
        {ROWS.map((row, r) => (
          <View key={row} style={s.gridRow}>
            <Text style={s.rowLabel}>{row}</Text>
            {COLS.map((col, c) => {
              const v = share(r * 3 + c);
              return (
                <View key={col} style={[s.cell, { backgroundColor: `rgba(178,11,194,${0.06 + v * 0.8})` }]}>
                  <Text style={[s.cellText, v >= 0.45 && { color: '#FFFFFF' }]}>{Math.round(v * 100)}%</Text>
                </View>
              );
            })}
          </View>
        ))}
        <View style={s.gridRow}>
          <Text style={s.rowLabel} />
          {COLS.map(col => <Text key={col} style={s.colLabel}>{col}</Text>)}
        </View>
      </View>
      <Text style={ui.body}>{counts.join('\n')}</Text>
      <Text style={ui.small}>처음 가만히 선 자리를 기준으로 한 머문 시간 비율이에요. 왼쪽·오른쪽은 춤추는 사람 기준이에요.</Text>
    </Card>
  );
}

const s = StyleSheet.create({
  grid: { gap: 6 },
  gridRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowLabel: { width: 34, color: C.sub, fontSize: 12 },
  cell: { flex: 1, height: 40, borderRadius: 8, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  cellText: { color: C.text, fontSize: 12, fontVariant: ['tabular-nums'] },
  colLabel: { flex: 1, textAlign: 'center', color: C.sub, fontSize: 12 },
});
