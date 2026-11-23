import { Text } from '../../ui/Typography';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { floorTransform, ImageHeatmap, type Point } from '../../projection/heatmap';
import { DEFAULT_CONFIG } from '../../tracking/config';
import { buildPacket } from '../../tracking/display';
import type { LiveTrackingStore } from '../../tracking/store';
import { C } from '../../theme';
import { useLibrary } from '../../state/LibraryProvider';
import type { Session } from '../../state/model';
import { ui } from '../../ui/Kit';

export type DisplayProposal = { id: string; kind: 'help' | 'suggestion'; title: string; detail: string; symbol: string; reason?: string };
const parts = ['arm_l', 'arm_r', 'leg_l', 'leg_r'] as const;
function usageHistory(sessions: Session[]) {
  const sums = Object.fromEntries(parts.map(part => [part, { score: 0, observed: 0 }])) as Record<typeof parts[number], { score: number; observed: number }>;
  for (const session of sessions) {
    if (!session.tracking || session.tracking.trackedMs < 30000) continue;
    for (const part of parts) {
      sums[part].score += session.tracking.totals.score[part] ?? 0;
      sums[part].observed += session.tracking.totals.observed[part] ?? 0;
    }
  }
  // Compare only if all four parts were observed; absence is not inactivity.
  if (parts.some(part => sums[part].observed === 0)) return undefined;
  const values = parts.map(part => Math.max(0, sums[part].score / sums[part].observed));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return undefined;
  return Object.fromEntries(parts.map((part, index) => [part, values[index] / total]));
}
function roomId() { return Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join(''); }
export default function ProjectionCard({ projectId, sessionId, store, server, playing, recording, corners, loop, saveRevision, missionTitle, onAgent, choice }: { projectId: string; sessionId: string; store: LiveTrackingStore; server: string; playing: boolean; recording: boolean; corners: Point[]; loop: { start: number; end: number } | null; saveRevision: number; missionTitle?: string; onAgent: (proposal: DisplayProposal | null) => void; choice: { id: string; accept: boolean } | null }) {
  const { data } = useLibrary();
  const historyRef = useRef<{ projectUsage?: Record<string, number>; overallUsage?: Record<string, number> }>({});
  useEffect(() => {
    const past = data.sessions.filter(session => session.id !== sessionId);
    historyRef.current = { projectUsage: usageHistory(past.filter(session => session.projectId === projectId)), overallUsage: usageHistory(past) };
  }, [data.sessions, projectId, sessionId]);
  const [enabled, setEnabled] = useState(false), [status, setStatus] = useState('');
  const [room] = useState(roomId);
  const heat = useRef(new ImageHeatmap()), live = useRef(playing), recordingRef = useRef(recording), contextRef = useRef({ loop, saveRevision }), calibrated = useRef(false);
  const socketRef = useRef<WebSocket | null>(null), agentCallback = useRef(onAgent);
  useEffect(() => { agentCallback.current = onAgent; }, [onAgent]);
  useEffect(() => { if (choice && socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ type: 'agent_response', proposalId: choice.id, choice: choice.accept ? 'accept' : 'dismiss' })); }, [choice]);
  useEffect(() => { live.current = playing; }, [playing]);
  useEffect(() => { recordingRef.current = recording; }, [recording]);
  useEffect(() => { contextRef.current = { loop, saveRevision }; }, [loop, saveRevision]);
  useEffect(() => { const transform = floorTransform(corners); calibrated.current = !!transform; heat.current = new ImageHeatmap(transform); }, [corners]);
  const base = server.trim().replace(/\/$/, '');
  useEffect(() => {
    if (!enabled) return;
    let socket: WebSocket;
    try { socket = new WebSocket(`${base.replace(/^http/, 'ws')}/projection/ws/${room}/publish`); }
    catch { void Promise.resolve().then(() => setStatus("Check the server address.")); return; }
    socketRef.current = socket;
    socket.onopen = () => setStatus("Connected to server. Open a display address to view.");
    socket.onmessage = event => { try { const packet = JSON.parse(event.data); const proposal = packet?.agent?.proposal; agentCallback.current(proposal && typeof proposal.id === 'string' && (proposal.kind === 'help' || proposal.kind === 'suggestion') ? proposal : null); } catch {} };
    socket.onerror = () => setStatus("Could not connect. Check the server address and Wi-Fi.");
    socket.onclose = () => setStatus("Connection closed. Start it again.");
    const timer = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) return;
      const view = store.getView(), active = recordingRef.current && live.current && view.status?.state === 'tracking' && !!view.usage['8count']?.tracking_ok && !!view.pose && Date.now() - view.pose.t < 500;
      const music = store.getMusicSnapshot(), labeler = store.labeler, windows = DEFAULT_CONFIG.aggregate.windows;
      // The same packet the webcam display builds (tracking/display.ts): rings, movement words, what is lacking and tried.
      const packet = buildPacket({
        source: 'phone', active, cells: heat.current.update(view.pose, active, Date.now()), label: active ? labeler.label() : null, usage: view.usage,
        zones30: labeler.zoneShares(windows.recent_s), zones8: labeler.zoneShares(windows['8count_s']), answering: false,
      }, DEFAULT_CONFIG);
      socket.send(JSON.stringify({ ...packet, calibrated: calibrated.current, missionTitle, context: { position: music?.position ?? null, playing: music?.playing === true, loop: contextRef.current.loop, saveRevision: contextRef.current.saveRevision, ...historyRef.current }, recording: recordingRef.current }));
    }, 250);
    return () => { clearInterval(timer); socketRef.current = null; agentCallback.current(null); if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ active: false, cells: Array(64).fill(0) })); socket.close(); };
  }, [enabled, base, room, store, missionTitle]);
  return <View style={{ gap: 8, padding: 16, borderRadius: 16, backgroundColor: C.card }}><Text style={ui.h3}>Connect projection display</Text>
    <Text style={ui.body}>Open the address below in the projector browser on the same Wi-Fi network.</Text>
    <Text style={ui.small}>Floor projection</Text><Text selectable style={ui.link}>{base}/projection/{room}</Text><Text style={ui.small}>Creative display</Text><Text selectable style={ui.link}>{base}/display/{room}</Text>
    <Pressable accessibilityRole="button" onPress={() => { if (!enabled) heat.current = new ImageHeatmap(floorTransform(corners)); setEnabled(!enabled); }}><Text style={ui.link}>{enabled ? "Stop projection" : "Start projection"}</Text></Pressable>
    {!!status && <Text style={ui.small}>{status}</Text>}<Text style={ui.small}>Only aggregate movement data is sent; video and landmarks stay on this device. {corners.length === 4 && floorTransform(corners) ? "Foot positions are estimated from the four display corners." : "Before calibration, this shows foot positions in the camera view."}</Text></View>;
}
