import { Text, View } from 'react-native';
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
      <Text style={ui.h3}>카메라로 본 몸 사용</Text>
      <Text style={ui.body}>세션의 카메라 탭에서 춤추면 기록이 쌓여요.</Text>
    </Card>
  );
  return (
    <Card>
      <View style={ui.between}>
        <Text style={ui.h3}>카메라로 본 몸 사용</Text>
        <Text style={ui.pill}>{insight.sessions}개 세션 · {fmtTime(insight.trackedMs / 1000)}</Text>
      </View>
      <BodyUsageBars segments={insight.segments} underused={[]} />
      <Text style={ui.body}>높이  {(['low', 'mid', 'high'] as const).map(l => `${LEVEL_NAMES[l]} ${Math.round(insight.level[l] * 100)}%`).join(' · ')}</Text>
      {insight.unexplored.length > 0 && (
        <View style={{ gap: 6 }}>
          <Text style={ui.h3}>자주 안 가본 쪽</Text>
          {insight.unexplored.slice(0, 4).map(u => <Text key={u.target} style={ui.body}>{label(u.target)} · {insight.sessions}개 세션 중 {u.count}번</Text>)}
        </View>
      )}
      <Text style={ui.small}>카메라 탭에서 음악을 재생한 동안의 부위·높이 비율이에요. 잘하고 못함을 뜻하지 않아요.</Text>
    </Card>
  );
}