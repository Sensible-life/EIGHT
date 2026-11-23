import { Text } from '../../ui/Typography';
import { Pressable, View } from 'react-native';
import type { LiveTrackingStore } from '../../tracking/store';
import { C } from '../../theme';
import ProjectionCard, { type DisplayProposal } from './ProjectionCard';

type Props = { projectId: string; sessionId: string; store: LiveTrackingStore; playing: boolean; onPlay: () => void; server: string; onSave?: () => void; saved?: boolean; loop: { start: number; end: number } | null; saveRevision: number; missionTitle?: string; canRecord: boolean; recordCommand: number; onAgent: (proposal: DisplayProposal | null) => void; agentChoice: { id: string; accept: boolean } | null; onVideo: (event: { state: 'started' | 'stopped' | 'saved' | 'error' | 'pending'; value: string }) => void; phase: 'idle' | 'starting' | 'recording' | 'processing' | 'review'; recording: boolean; onRecord: () => void };
export default function CameraTab(p: Props) {
  return <View style={{ gap: 14 }}>
    <ProjectionCard projectId={p.projectId} sessionId={p.sessionId} store={p.store} server={p.server} playing={p.playing} recording={p.recording} corners={[]} loop={p.loop} saveRevision={p.saveRevision} missionTitle={p.missionTitle} onAgent={p.onAgent} choice={p.agentChoice} recordCommand={p.recordCommand} onVideo={p.onVideo} />
    <Pressable accessibilityRole="button" disabled={!p.canRecord && !p.recording} onPress={p.onRecord} style={{ backgroundColor: C.card, padding: 16, borderRadius: 14, opacity: !p.canRecord && !p.recording ? .5 : 1 }}><Text>{p.recording ? 'Stop webcam recording' : 'Start webcam recording'}</Text></Pressable>
    <Text accessibilityLiveRegion="polite" style={{ color: p.recording ? '#F05065' : C.sub }}>{p.phase === 'recording' ? '● REC · Webcam recording' : p.phase === 'starting' ? 'Preparing webcam…' : p.phase === 'processing' ? 'Transferring video…' : p.phase === 'review' ? 'Ready to review' : 'Ready'}</Text>
    <Text>Record with the connected webcam. Use the watch or this button to start and stop.</Text>
  </View>;
}
