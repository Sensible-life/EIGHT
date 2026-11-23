// The display's frame loop, and the entry of the bundle the server's display page loads (scripts/build-display.cjs).
// Webcam frame in -> the same tracking session as the phone (usage, levels, calibration), the movement words, the
// overhead-O answer and the foot heatmap -> one packet for the relay. Video and landmarks stay in the page: the packet
// holds only known words and bounded numbers (server/app/projection.py checks them again).
import { OverheadAnswer } from './answer';
import { DEFAULT_CONFIG, type TrackingConfig } from './config';
import { MovementLabeler, type MovementLabel, type SpaceLabel, type Zone } from './labels';
import { LiveSession } from './session';
import { poseFromEvent } from './store';
import { exploredTargets, lackingTargets, ringShares, type Target } from './targets';
import { ImageHeatmap } from '../projection/heatmap';
import type { OutMessage, PoseEvent, PoseMessage, StatusMessage, UsageMessage, WindowName } from './types';

export { webPoseEvent } from './webEvent';
export { SKELETON_EDGES } from './segments';
export { DEFAULT_CONFIG } from './config';
export { TARGET_ORDER, type Target } from './targets';

export type DisplayPacket = {
  active: boolean;
  calibrated: boolean; // floor corners known (phone only); the webcam shows camera-view positions
  cells: number[]; // 8 x 8 foot heatmap
  source: 'webcam' | 'phone';
  movement?: Pick<MovementLabel, 'speed' | 'size' | 'direction' | 'texture' | 'lead' | 'timing'>;
  parts?: MovementLabel['parts'];
  space?: SpaceLabel;
  body?: { upper: number; lower: number; underused: Target[] }; // underused: what the character may point out
  explored?: Target[]; // tried in the last 8-count
  answering?: boolean; // an overhead O is being held
};

export type PacketInput = {
  source: 'webcam' | 'phone'; active: boolean; cells: number[]; label: MovementLabel | null;
  usage: Partial<Record<WindowName, UsageMessage>>; zones30: Record<Zone, number> | null; zones8: Record<Zone, number> | null; answering: boolean;
};

/** The relay packet. While nobody is tracked it carries only the heatmap, so nothing stale is shown or judged. */
export function buildPacket(i: PacketInput, cfg: TrackingConfig): DisplayPacket {
  const p: DisplayPacket = { active: i.active, calibrated: false, cells: i.cells, source: i.source };
  if (!i.active) return p;
  if (i.label) {
    const { speed, size, direction, texture, lead, timing } = i.label;
    p.movement = { speed, size, direction, texture, lead, timing };
    p.parts = i.label.parts;
    if (i.label.space) p.space = i.label.space;
  }
  const rings = ringShares(i.usage.recent);
  if (rings) p.body = { ...rings, underused: lackingTargets(i.usage.recent, i.zones30, cfg) };
  p.explored = exploredTargets(i.usage['8count'], i.zones8, cfg);
  if (i.answering) p.answering = true;
  return p;
}

export type DisplayContext = { musicT: number | null; beatS: number | null; playing: boolean; asking: boolean };
export type DisplayFrame = {
  packet: DisplayPacket;
  pose: PoseMessage | null; // for drawing the skeleton (debug view)
  status: StatusMessage | null;
  usage: Partial<Record<WindowName, UsageMessage>>;
  label: MovementLabel | null;
  lacking: Target[];
  answer: { progress: number; yes: boolean };
};

export class DisplayTracker {
  private session!: LiveSession;
  private labeler!: MovementLabeler;
  private answer!: OverheadAnswer;
  private heat!: ImageHeatmap;
  private usage: Partial<Record<WindowName, UsageMessage>> = {};
  private status: StatusMessage | null = null;
  private pose: PoseMessage | null = null;
  private nowMs = 0; // message timestamps are frame times, so the heatmap and the windows share one clock
  private lastTMs: number | null = null;

  constructor(private readonly cfg: TrackingConfig = DEFAULT_CONFIG) {
    this.reset();
  }

  /** Start over: calibrate again, forget every window (a new camera, a looped video). */
  reset(): void {
    this.session = new LiveSession(this.cfg, m => this.onMessage(m), { model: 'lite', delegate: 'gpu', captureFrom: 'analyzer', clockMs: () => this.nowMs });
    this.labeler = new MovementLabeler(this.cfg.labels);
    this.answer = new OverheadAnswer(this.cfg.answer);
    this.heat = new ImageHeatmap();
    this.usage = {};
    this.status = null;
    this.pose = null;
    this.lastTMs = null;
  }

  step(e: PoseEvent, ctx: DisplayContext): DisplayFrame {
    if (this.lastTMs !== null && e.tMs < this.lastTMs) this.reset();
    this.lastTMs = this.nowMs = e.tMs;
    const pose = poseFromEvent(e);
    if (!pose) this.pose = null;
    this.session.step(e.tMs, pose, e.aspect, { playing: ctx.playing, musicT: ctx.musicT });
    if (pose) this.labeler.add({ tMs: e.tMs, image: pose.image.map(p => [p[0], p[1]] as [number, number]), visibility: pose.visibility, aspect: e.aspect, musicT: ctx.musicT, beatS: ctx.beatS });
    const answer = this.answer.update(pose, e.aspect, ctx.asking, e.tMs);
    const active = pose !== null && this.session.pipeline.tracker.state === 'tracking';
    const cells = this.heat.update(this.pose, active, e.tMs);
    const label = active ? this.labeler.label() : null;
    const zones30 = this.labeler.zoneShares(this.cfg.aggregate.windows.recent_s), zones8 = this.labeler.zoneShares(this.cfg.aggregate.windows['8count_s']);
    const packet = buildPacket({ source: 'webcam', active, cells, label, usage: this.usage, zones30, zones8, answering: answer.progress > 0 }, this.cfg);
    const lacking = active ? lackingTargets(this.usage.recent, zones30, this.cfg) : [];
    return { packet, pose: this.pose, status: this.status, usage: this.usage, label, lacking, answer };
  }

  private onMessage(m: OutMessage): void {
    if (!('type' in m)) this.usage = { ...this.usage, [m.window]: m };
    else if (m.type === 'status') this.status = m;
    else if (m.type === 'pose') this.pose = m;
  }
}
