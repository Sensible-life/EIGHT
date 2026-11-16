import { Text } from '../ui/Typography';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Pressable, View } from 'react-native';
import WatchNative from '../../modules/watch-haptics';
import type { Mix } from '../audio/mix';
import { isWatchMixerCommand, type WatchMixerCommand } from '../audio/watchMixer';
import { C, STEM_LABELS } from '../theme';
import { ui } from '../ui/Kit';
import { useDevice } from '../state/DeviceProvider';

export default function WatchMixerCard({ mix, master, onCommands, suggestion, notifySuggestion = false, onSuggestion, recordAvailable, recording, onRecord }: { mix: Mix; master: number; onCommands: (commands: WatchMixerCommand[]) => void; suggestion: { id: string; title: string } | null; notifySuggestion?: boolean; onSuggestion: (id: string, accept: boolean) => void; recordAvailable: boolean; recording: boolean; onRecord: () => void }) {
  const { connected, status: connectionStatus, reportWatchError } = useDevice();
  const session = useRef(''), currentMix = useRef(mix), currentMaster = useRef(master), callback = useRef(onCommands), currentSuggestion = useRef(suggestion), suggestionCallback = useRef(onSuggestion);
  const notified = useRef('');
  const currentRecording = useRef({ recordAvailable, recording, onRecord });
  useEffect(() => { currentRecording.current = { recordAvailable, recording, onRecord }; }, [recordAvailable, recording, onRecord]);
  useEffect(() => { if (connected && notifySuggestion && suggestion && notified.current !== suggestion.id && WatchNative) { notified.current = suggestion.id; void WatchNative.test().catch(reportWatchError); } }, [connected, notifySuggestion, suggestion, reportWatchError]);
  useEffect(() => { currentMix.current = mix; currentMaster.current = master; callback.current = onCommands; currentSuggestion.current = suggestion; suggestionCallback.current = onSuggestion; }, [mix, master, onCommands, suggestion, onSuggestion]);
  useEffect(() => {
    if (!connected || !WatchNative) return;
    session.current = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let cancelled = false, pending = false;
    const poll = async () => {
      if (pending || cancelled) return;
      pending = true;
      try {
        const layers = Object.entries(currentMix.current).map(([stem, layer]) => ({ stem, label: STEM_LABELS[stem] ?? stem, percent: Math.round(layer.volume * 100), muted: layer.muted, solo: layer.solo }));
        const result = JSON.parse(await WatchNative!.mixer(JSON.stringify({ session: session.current, controlsVersion: 2, masterPercent: Math.round(currentMaster.current * 100), layers, suggestion: currentSuggestion.current, recordAvailable: currentRecording.current.recordAvailable, recording: currentRecording.current.recording })));
        if (!cancelled && Array.isArray(result.commands)) {
          const commands = result.commands.filter((command: unknown) => isWatchMixerCommand(command, session.current));
          if (commands.length) callback.current(commands);
          for (const command of result.commands) if (command && command.session === session.current && typeof command.suggestionId === 'string' && (command.choice === 'accept' || command.choice === 'dismiss')) suggestionCallback.current(command.suggestionId, command.choice === 'accept');
          for (const command of result.commands) if (command && command.session === session.current && command.action === 'record' && currentRecording.current.recordAvailable) currentRecording.current.onRecord();
        }
      } catch (error) { if (!cancelled) reportWatchError(error); }
      finally { pending = false; }
    };
    void poll(); const timer = setInterval(() => void poll(), 500);
    return () => { cancelled = true; clearInterval(timer); };
  }, [connected, reportWatchError]);
  return <View style={{ backgroundColor: C.card, borderRadius: 18, padding: 18, marginTop: 18, gap: 8 }}><Text style={ui.h3}>Control layers from watch</Text>
    <Text style={ui.body}>{WatchNative ? connected ? 'Adjust layer volume, mute, solo and master volume on your watch.' : `${connectionStatus} Open Settings to reconnect.` : "Available in an Android development build."}</Text>
    {!!WatchNative && !connected && <Pressable accessibilityRole="button" onPress={() => router.push('/settings')} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={ui.link}>Open device settings</Text></Pressable>}
    <Text style={ui.small}>Keep both apps open while using watch controls.</Text></View>;
}
