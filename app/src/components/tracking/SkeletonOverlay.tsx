import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { projectToBox } from '../../tracking/overlay';
import { SKELETON_EDGES, segmentOf } from '../../tracking/segments';
import type { PoseMessage, Segment } from '../../tracking/types';
import { C } from '../../theme';

type Props = { pose: PoseMessage | null; shares: Record<Segment, number> | null; underused: Segment[]; boxAspect: number; visibility: number };

const JOINTS = Array.from(new Set(SKELETON_EDGES.flat()));
// A body part carrying this share of the session's movement (a third; an even split over six parts is 1/6) draws at full strength.
const FULL_STRENGTH_SHARE = 1 / 3;
const LINK_OPACITY = 0.5; // lines between two different parts: fixed base

/** Stick figure over the mirrored preview. Busier parts draw stronger; quiet ones get a dashed ring. */
export default function SkeletonOverlay({ pose, shares, underused, boxAspect, visibility }: Props) {
  if (!pose) return null;
  const W = 100 * boxAspect; // viewBox width: keeps circles round in the box
  const at = (i: number) => {
    const p = projectToBox(pose.lm[i][0], pose.lm[i][1], pose.aspect, boxAspect);
    return { x: p.x * W, y: p.y * 100 };
  };
  const seen = (i: number) => pose.lm[i][2] >= visibility;
  const strength = (i: number) => {
    const seg = segmentOf(i);
    return seg && shares ? Math.min(1, shares[seg] / FULL_STRENGTH_SHARE) : 0;
  };
  const lineOpacity = (a: number, b: number) => (segmentOf(a) !== null && segmentOf(a) === segmentOf(b) ? 0.35 + 0.65 * strength(a) : LINK_OPACITY);
  return (
    <View style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${W} 100`}>
        {SKELETON_EDGES.filter(([a, b]) => seen(a) && seen(b)).map(([a, b]) => {
          const p = at(a), q = at(b);
          return <Line key={`${a}-${b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={C.accent} strokeOpacity={lineOpacity(a, b)} strokeWidth={0.8} />;
        })}
        {JOINTS.filter(seen).map(i => {
          const p = at(i), seg = segmentOf(i), quiet = !!seg && underused.includes(seg);
          return (
            <Circle key={i} cx={p.x} cy={p.y} r={quiet ? 2.2 : 1.6} fill={C.accent} fillOpacity={0.35 + 0.65 * strength(i)}
              stroke={quiet ? '#FFFFFF' : 'none'} strokeWidth={0.5} strokeDasharray={quiet ? '1 1' : undefined} />
          );
        })}
      </Svg>
    </View>
  );
}
