import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Rect, Text as SvgText } from 'react-native-svg';
import { heatStrength, wholePercents, type BodyShares } from '../../tracking/bodyMap';
import { SEGMENT_LABELS } from '../../tracking/phrases';
import type { Segment } from '../../tracking/types';
import { C } from '../../theme';

type Props = { shares: BodyShares; underused?: Segment[]; dim?: boolean };

// Mirror view, like the old card and a dance-studio mirror: the dancer's left arm/leg on the screen's left.
const W = 220, H = 270, CX = W / 2;
const SHORT_LABELS: Record<Segment, string> = { head: 'Head', torso: 'Torso', arm_l: 'L arm', arm_r: 'R arm', leg_l: 'L leg', leg_r: 'R leg' };
type Part = { seg: Segment; shape: 'circle' | 'rect'; x: number; y: number; w: number; h: number; rot?: number; label: { x: number; y: number; anchor: 'start' | 'middle' | 'end' } };
const PARTS: Part[] = [
  { seg: 'head', shape: 'circle', x: CX, y: 30, w: 19, h: 19, label: { x: CX + 28, y: 26, anchor: 'start' } },
  { seg: 'torso', shape: 'rect', x: CX - 23, y: 56, w: 46, h: 84, label: { x: CX, y: 98, anchor: 'middle' } },
  { seg: 'arm_l', shape: 'rect', x: CX - 46, y: 58, w: 18, h: 86, rot: 14, label: { x: 4, y: 104, anchor: 'start' } },
  { seg: 'arm_r', shape: 'rect', x: CX + 28, y: 58, w: 18, h: 86, rot: -14, label: { x: W - 4, y: 104, anchor: 'end' } },
  { seg: 'leg_l', shape: 'rect', x: CX - 22, y: 144, w: 19, h: 112, rot: 5, label: { x: 4, y: 214, anchor: 'start' } },
  { seg: 'leg_r', shape: 'rect', x: CX + 3, y: 144, w: 19, h: 112, rot: -5, label: { x: W - 4, y: 214, anchor: 'end' } },
];

/** Body figure filled by how much each part moved, with whole-number percentages (sum 100). */
export default function BodyHeatmap({ shares, underused = [], dim = false }: Props) {
  const pct = wholePercents(shares);
  return (
    <View style={[s.wrap, dim && s.dim]} accessible accessibilityLabel={PARTS.map(p => `${SEGMENT_LABELS[p.seg]} ${pct[p.seg] === null ? "Not measured" : `${pct[p.seg]} percent`}`).join(', ')}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`}>
        {PARTS.map(p => {
          const measured = shares[p.seg] !== null, quiet = underused.includes(p.seg);
          const fill = measured ? C.accent : C.line, opacity = measured ? heatStrength(shares[p.seg]) : 1;
          const stroke = quiet ? { stroke: C.accent, strokeWidth: 1.5, strokeDasharray: '4 3' } : {};
          return (
            <G key={p.seg} transform={p.rot ? `rotate(${p.rot} ${p.x + p.w / 2} ${p.y})` : undefined}>
              {p.shape === 'circle'
                ? <Circle cx={p.x} cy={p.y} r={p.w} fill={fill} fillOpacity={opacity} {...stroke} />
                : <Rect x={p.x} y={p.y} width={p.w} height={p.h} rx={p.w / 2 > 12 ? 12 : p.w / 2} fill={fill} fillOpacity={opacity} {...stroke} />}
            </G>
          );
        })}
        {PARTS.map(p => {
          const v = pct[p.seg], strong = p.seg === 'torso' && heatStrength(shares[p.seg]) > 0.55;
          const color = p.seg === 'torso' ? (strong ? '#FFFFFF' : C.text) : C.text;
          return (
            <G key={`l-${p.seg}`}>
              <SvgText x={p.label.x} y={p.label.y} textAnchor={p.label.anchor} fontSize={10} fontFamily="SpaceGrotesk_500Medium" fill={p.seg === 'torso' ? color : C.sub}>{SHORT_LABELS[p.seg]}</SvgText>
              <SvgText x={p.label.x} y={p.label.y + 17} textAnchor={p.label.anchor} fontSize={18} fontFamily="SpaceGrotesk_600SemiBold" fill={color}>{v === null ? '—' : `${v}%`}</SvgText>
            </G>
          );
        })}
      </Svg>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { width: '100%', aspectRatio: W / H, maxHeight: 300, alignSelf: 'center' },
  dim: { opacity: 0.45 },
});
