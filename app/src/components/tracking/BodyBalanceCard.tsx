import { Text } from '../../ui/Typography';
import { router } from 'expo-router';
import { View } from 'react-native';
import type { MotionResult } from '../../motion/analyze';
import type { Session } from '../../state/model';
import { extremes, fromSegments, fromStudio, type BodyShares } from '../../tracking/bodyMap';
import { trackingInsights } from '../../tracking/insights';
import { label, LEVEL_NAMES, SEGMENT_LABELS } from '../../tracking/phrases';
import { C, fmtTime } from '../../theme';
import { Button, Card, Icon, ui } from '../../ui/Kit';
import BodyHeatmap from './BodyHeatmap';

type Props = { sessions: Session[]; latest?: MotionResult };
export default function BodyBalanceCard({ sessions, latest }: Props) {
  const saved = savedShares(sessions, latest);
  const insight = trackingInsights(sessions.map(x => x.tracking));
  return <Card><View style={ui.between}><Text style={ui.h3}>Movement balance</Text><Text style={ui.pill}>{saved.pill}</Text></View>
    {insight || latest ? <><BodyHeatmap shares={saved.shares} /><Highlight shares={saved.shares} /></> : <View style={{ alignItems: 'center', paddingVertical: 20, gap: 8 }}><Icon name="body-outline" size={34} color={C.accent} /><Text style={ui.h3}>No movement recorded yet</Text></View>}<Text style={ui.body}>{saved.note}</Text>
    {insight && <><Text style={ui.body}>Height  {(['low', 'mid', 'high'] as const).map(l => `${LEVEL_NAMES[l]} ${Math.round(insight.level[l] * 100)}%`).join(' · ')}</Text>
      {insight.unexplored.length > 0 && <View><Text style={ui.h3}>Less-used areas</Text>{insight.unexplored.slice(0, 4).map(u => <Text key={u.target} style={ui.body}>{label(u.target)} · {u.count} times</Text>)}</View>}</>}
    {!insight && !latest && <Button title={"Open session camera"} secondary onPress={() => router.push('/new-session')} />}
  </Card>;
}
const EMPTY: BodyShares = { head: 0, torso: 0, arm_l: 0, arm_r: 0, leg_l: 0, leg_r: 0 };

function savedShares(sessions: Session[], latest?: MotionResult): { shares: BodyShares; pill: string; note: string } {
  const insight = trackingInsights(sessions.map(x => x.tracking));
  if (insight) return {
    shares: fromSegments(insight.segments),
    pill: `Camera history · ${insight.sessions} sessions`,
    note: `Share of movement by body part during ${fmtTime(insight.trackedMs / 1000)} of music playback with the session camera.`,
  };
  if (latest) return {
    shares: fromStudio(latest.body),
    pill: latest.source === 'sample' ? "Latest sample analysis" : "Latest pose analysis",
    note: "Pose analysis from Motion Studio. The head is not shown because the data does not include it.",
  };
  return { shares: EMPTY, pill: "No data", note: "Use the camera during a session to see your movement." };
}

function Highlight({ shares }: { shares: BodyShares }) {
  const e = extremes(shares);
  return e ? <Text style={ui.body}>Most active {SEGMENT_LABELS[e.most]} · least active {SEGMENT_LABELS[e.least]}</Text> : null;
}
