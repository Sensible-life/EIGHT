import { Text } from '../../ui/Typography';
import { View } from 'react-native';
import type { Session } from '../../state/model';
import { trackingInsights } from '../../tracking/insights';
import { label, LEVEL_NAMES } from '../../tracking/phrases';
import { C, fmtTime } from '../../theme';
import { Card, Icon, ui } from '../../ui/Kit';
import BodyUsageBars from './BodyUsageBars';

/** Analysis tab: what the camera tab saw over the chosen period. Facts and counts, never a score. */
export default function TrackingInsightCard({ sessions }: { sessions: Session[] }) {
  const insight = trackingInsights(sessions.map(s => s.tracking));
  if (!insight) return (
    <Card>
      <Icon name="body-outline" color={C.dim} size={28} />
      <Text style={ui.h3}>Body movement from camera</Text>
      <Text style={ui.body}>Use the camera during a session to collect data.</Text>
    </Card>
  );
  return (
    <Card>
      <View style={ui.between}>
        <Text style={ui.h3}>Body movement from camera</Text>
        <Text style={ui.pill}>{insight.sessions} sessions · {fmtTime(insight.trackedMs / 1000)}</Text>
      </View>
      <BodyUsageBars segments={insight.segments} underused={[]} />
      <Text style={ui.body}>Height  {(['low', 'mid', 'high'] as const).map(l => `${LEVEL_NAMES[l]} ${Math.round(insight.level[l] * 100)}%`).join(' · ')}</Text>
      {insight.unexplored.length > 0 && (
        <View style={{ gap: 6 }}>
          <Text style={ui.h3}>Less-used areas</Text>
          {insight.unexplored.slice(0, 4).map(u => <Text key={u.target} style={ui.body}>{label(u.target)} · {insight.sessions} sessions: {u.count} times</Text>)}
        </View>
      )}
      <Text style={ui.small}>Body-part and height distribution while music played with the camera. This is not a performance score.</Text>
    </Card>
  );
}