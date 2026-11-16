import { Text } from '../ui/Typography';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { videoDuration } from '../editor/videoDuration';
import { deleteMedia, saveMedia } from '../storage/media';
import { useLibrary } from '../state/LibraryProvider';
import { C, fmtTime } from '../theme';
import { Button, Card, Icon, ui } from '../ui/Kit';
import { confirmAction } from '../ui/confirm';
import { displayMessage } from '../ui/displayMessage';
import VideoPreview from '../ui/VideoPreview';

export default function ProjectVideos({ projectId }: { projectId: string }) {
  const { data, updateExtras } = useLibrary();
  const [selected, setSelected] = useState<string | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const videos = (data.extras?.motifs ?? []).filter(m => m.projectId === projectId && !!m.video);
  const active = videos.find(v => v.id === selected);
  const importVideo = async () => {
    if (busy) return;
    if ((data.extras?.motifs.length ?? 0) >= 1000) { setMessage('The library has reached its 1,000 clip limit.'); return; }
    setBusy(true); setMessage('');
    let stored: string | undefined;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], quality: 1 });
      if (result.canceled) return;
      const asset = result.assets[0];
      const duration = asset.duration && asset.duration > 0 ? asset.duration / 1000 : await videoDuration(asset.uri);
      if (!Number.isFinite(duration) || duration < 0.1 || duration > 86400) throw new Error('Video duration must be between 0.1 seconds and 24 hours.');
      const suffix = /\.[a-zA-Z0-9]{2,5}$/.exec(asset.fileName ?? '')?.[0] ?? '.mp4';
      stored = await saveMedia(asset.uri, suffix);
      const video = stored, id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      updateExtras(e => ({ ...e, motifs: [{ id, projectId, name: asset.fileName?.replace(/\.[^.]+$/, '') || 'Imported video', createdAt: Date.now(), start: 0, end: duration, eightIndex: null, video }, ...e.motifs] }));
      setSelected(id); setMessage('Video saved to this project.');
    } catch (error) { if (stored) await deleteMedia(stored).catch(() => {}); setMessage(displayMessage(error)); }
    finally { setBusy(false); }
  };
  const remove = (id: string) => {
    const used = [...(data.extras?.timelines ?? []), ...(data.extras?.finished ?? [])].some(t => t.clips.some(c => c.motifId === id)) || (data.extras?.compositions ?? []).some(c => c.motifIds.includes(id));
    if (used) { setMessage('This video is used in a timeline or saved composition. Remove it there first.'); return; }
    const item = videos.find(v => v.id === id);
    confirmAction('Delete video', 'This video will be removed from the project and device.', () => {
      updateExtras(e => ({ ...e, motifs: e.motifs.filter(m => m.id !== id) }));
      if (item?.video) void deleteMedia(item.video).catch(error => setMessage(displayMessage(error)));
      if (selected === id) setSelected(null);
    });
  };
  return <View style={{ gap: 12 }}>
    <View style={ui.between}><View style={{ flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 7 }}><Text style={ui.h2}>Video clips</Text><Text style={ui.small}>{videos.length}</Text></View><Pressable accessibilityRole="button" disabled={busy} onPress={() => void importVideo()} style={{ minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' }}><Text style={ui.link}>{busy ? 'Importing…' : '＋ Import'}</Text></Pressable></View>
    {videos.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>{videos.map(video => <Pressable key={video.id} accessibilityRole="button" accessibilityState={{ selected: selected === video.id }} onPress={() => setSelected(selected === video.id ? null : video.id)} style={{ width: 136, minHeight: 94, padding: 12, borderRadius: 14, backgroundColor: selected === video.id ? C.cardHi : C.card, borderWidth: 1, borderColor: selected === video.id ? C.accent : C.line, justifyContent: 'space-between' }}><Icon name="videocam-outline" size={21} color={C.accent} /><View><Text numberOfLines={1} style={ui.h3}>{video.name}</Text><Text style={ui.small}>{fmtTime(video.end - video.start)}{video.sessionId ? ` · ${fmtTime(video.start)}` : ''}</Text></View></Pressable>)}</ScrollView> : <View style={{ minHeight: 58, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 14, backgroundColor: C.card }}><Text style={ui.small}>Record during practice or import a video.</Text></View>}
    {active?.video && <Card><View style={ui.between}><Text style={[ui.h3, { flex: 1 }]} numberOfLines={1}>{active.name}</Text><Pressable accessibilityRole="button" accessibilityLabel="Close video" onPress={() => setSelected(null)} style={{ padding: 10 }}><Icon name="close" size={18} /></Pressable></View><VideoPreview uri={active.video} /><Button title="Delete video" secondary onPress={() => remove(active.id)} /></Card>}
    {!!message && <Text accessibilityLiveRegion="polite" style={ui.body}>{message}</Text>}
  </View>;
}
