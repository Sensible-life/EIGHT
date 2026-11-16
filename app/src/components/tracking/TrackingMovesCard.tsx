import { Text } from '../../ui/Typography';
import { StyleSheet, View } from 'react-native';
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
    reach.up === 0 && "Reach up", reach.side === 0 && "Reach sideways", reach.down === 0 && "Reach down",
    m.clap === 0 && "Hands together", m.circle.l === 0 && "Left arm circle", m.circle.r === 0 && "Right arm circle",
    total(m.lift.l) === 0 && "Left leg lift", total(m.lift.r) === 0 && "Right leg lift", m.turnHalves === 0 && "Turns",
  ].filter((x): x is string => !!x);
}

/** Analysis tab: moves the camera tab counted while the music played. Counts of what happened, never a score. */
export default function TrackingMovesCard({ sessions }: { sessions: Session[] }) {
  const insight = moveInsights(sessions.map(s => s.tracking));
  if (!insight) return (
    <Card>
      <Icon name="walk-outline" color={C.dim} size={28} />
      <Text style={ui.h3}>Movements from camera</Text>
      <Text style={ui.body}>Use the camera during a session for over 30 seconds to count reaches, hands together, arm circles, leg lifts, and turns.</Text>
    </Card>
  );
  const m = insight.moves, legs = m.legTravel.l + m.legTravel.r, missing = notYet(m);
  const dirs = `Up ${m.reach.l.up + m.reach.r.up} · Side ${m.reach.l.side + m.reach.r.side} · Down ${m.reach.l.down + m.reach.r.down}`;
  const lifts = `Small ${m.lift.l.small + m.lift.r.small} · Large ${m.lift.l.big + m.lift.r.big}`;
  const rows: [string, string, string?][] = [
    ["Reaches", `Left arm ${total(m.reach.l)} · Right arm ${total(m.reach.r)}`, dirs],
    ["Hands together", `${m.clap}`],
    ["Arm circles", `Left arm ${m.circle.l} · Right arm ${m.circle.r}`],
    ["Leg lifts", `Left leg ${total(m.lift.l)} · Right leg ${total(m.lift.r)}`, lifts],
    ["Turns", `${m.turnHalves / 2} turns`],
  ];
  return (
    <Card>
      <View style={ui.between}>
        <Text style={ui.h3}>Movements from camera</Text>
        <Text style={ui.pill}>{insight.sessions} sessions · {fmtTime(insight.trackedMs / 1000)}</Text>
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
          <Text style={s.name}>Leg movement</Text>
          {legs > 0 ? (
            <View style={{ flex: 1, gap: 6 }}>
              {(['l', 'r'] as const).map(side => (
                <View key={side} style={s.barRow}>
                  <Text style={s.barLabel}>{side === 'l' ? "Left leg" : "Right leg"}</Text>
                  <View style={s.track}><View style={[s.fill, { width: `${(100 * m.legTravel[side]) / legs}%` }]} /></View>
                  <Text style={s.barValue}>{Math.round((100 * m.legTravel[side]) / legs)}%</Text>
                </View>
              ))}
            </View>
          ) : <Text style={[ui.small, { flex: 1 }]}>Visible when ankles are in frame.</Text>}
        </View>
      </View>
      {missing.length > 0 && (
        <View style={{ gap: 4 }}>
          <Text style={ui.h3}>Movements not detected yet</Text>
          <Text style={ui.body}>{missing.join(' · ')}</Text>
        </View>
      )}
      <Text style={ui.small}>Counts while music played with the camera. A single-camera estimate may miss or overcount movements; this is not a score.</Text>
    </Card>
  );
}

const s = StyleSheet.create({
  list: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  name: { width: 76, color: C.sub, fontSize: 13 },
  value: { color: C.text, fontSize: 14, fontFamily: 'SpaceGrotesk_600SemiBold', fontVariant: ['tabular-nums'] },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barLabel: { width: 48, color: C.sub, fontSize: 12 },
  track: { flex: 1, height: 9, borderRadius: 5, backgroundColor: C.bg, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 5, backgroundColor: C.accent },
  barValue: { width: 40, textAlign: 'right', color: C.text, fontSize: 12, fontVariant: ['tabular-nums'] },
});
