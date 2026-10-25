import { StyleSheet, Text, View } from 'react-native';
import type { Session } from '../../state/model';
import { moveInsights } from '../../tracking/insights';
import type { MoveTotals } from '../../tracking/types';
import { C, fmtTime } from '../../theme';
import { Card, Icon, ui } from '../../ui/Kit';

const total = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

/** Moves that did not come up at all in the period: shown as "아직 안 나온 동작", never as a warning. */
function notYet(m: MoveTotals): string[] {
  const reach = { up: m.reach.l.up + m.reach.r.up, side: m.reach.l.side + m.reach.r.side, down: m.reach.l.down + m.reach.r.down };
  return [
    reach.up === 0 && '위로 뻗기', reach.side === 0 && '옆으로 뻗기', reach.down === 0 && '아래로 뻗기',
    m.clap === 0 && '손 모으기', m.circle.l === 0 && '왼팔 돌리기', m.circle.r === 0 && '오른팔 돌리기',
    total(m.lift.l) === 0 && '왼다리 들기', total(m.lift.r) === 0 && '오른다리 들기', m.turnHalves === 0 && '회전',
  ].filter((x): x is string => !!x);
}

/** Analysis tab: moves the camera tab counted while the music played. Counts of what happened, never a score. */
export default function TrackingMovesCard({ sessions }: { sessions: Session[] }) {
  const insight = moveInsights(sessions.map(s => s.tracking));
  if (!insight) return (
    <Card>
      <Icon name="walk-outline" color={C.dim} size={28} />
      <Text style={ui.h3}>카메라로 본 동작</Text>
      <Text style={ui.body}>세션의 카메라 탭에서 30초 넘게 춤추면 팔 뻗기·손 모으기·팔 돌리기·다리 들기·회전을 세어 보여줘요.</Text>
    </Card>
  );
  const m = insight.moves, legs = m.legTravel.l + m.legTravel.r, missing = notYet(m);
  const dirs = `위 ${m.reach.l.up + m.reach.r.up} · 옆 ${m.reach.l.side + m.reach.r.side} · 아래 ${m.reach.l.down + m.reach.r.down}`;
  const lifts = `작게 ${m.lift.l.small + m.lift.r.small} · 크게 ${m.lift.l.big + m.lift.r.big}`;
  const rows: [string, string, string?][] = [
    ['팔 뻗기', `왼팔 ${total(m.reach.l)} · 오른팔 ${total(m.reach.r)}`, dirs],
    ['손 모으기', `${m.clap}번`],
    ['팔 돌리기', `왼팔 ${m.circle.l} · 오른팔 ${m.circle.r}`],
    ['다리 들기', `왼다리 ${total(m.lift.l)} · 오른다리 ${total(m.lift.r)}`, lifts],
    ['회전', `${m.turnHalves / 2}바퀴`],
  ];
  return (
    <Card>
      <View style={ui.between}>
        <Text style={ui.h3}>카메라로 본 동작</Text>
        <Text style={ui.pill}>{insight.sessions}개 세션 · {fmtTime(insight.trackedMs / 1000)}</Text>
      </View>
      <View style={s.list}>
        {rows.map(([name, value, detail]) => (
          <View key={name} style={s.row}>
            <Text style={s.name}>{name}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.value}>{value}</Text>
              {detail && <Text style={ui.small}>{detail}</Text>}
            </View>
          </View>
        ))}
        <View style={s.row}>
          <Text style={s.name}>다리 움직임</Text>
          {legs > 0 ? (
            <View style={{ flex: 1, gap: 6 }}>
              {(['l', 'r'] as const).map(side => (
                <View key={side} style={s.barRow}>
                  <Text style={s.barLabel}>{side === 'l' ? '왼다리' : '오른다리'}</Text>
                  <View style={s.track}><View style={[s.fill, { width: `${(100 * m.legTravel[side]) / legs}%` }]} /></View>
                  <Text style={s.barValue}>{Math.round((100 * m.legTravel[side]) / legs)}%</Text>
                </View>
              ))}
            </View>
          ) : <Text style={[ui.small, { flex: 1 }]}>발목이 화면에 들어오면 보여줘요.</Text>}
        </View>
      </View>
      {missing.length > 0 && (
        <View style={{ gap: 4 }}>
          <Text style={ui.h3}>아직 안 나온 동작</Text>
          <Text style={ui.body}>{missing.join(' · ')}</Text>
        </View>
      )}
      <Text style={ui.small}>카메라 탭에서 음악을 재생한 동안 센 횟수예요. 카메라 하나로 추정해서 놓치거나 더 셀 수 있고, 잘하고 못함을 뜻하지 않아요.</Text>
    </Card>
  );
}

const s = StyleSheet.create({
  list: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  name: { width: 76, color: C.sub, fontSize: 13 },
  value: { color: C.text, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barLabel: { width: 48, color: C.sub, fontSize: 12 },
  track: { flex: 1, height: 9, borderRadius: 5, backgroundColor: C.bg, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 5, backgroundColor: C.accent },
  barValue: { width: 40, textAlign: 'right', color: C.text, fontSize: 12, fontVariant: ['tabular-nums'] },
});
