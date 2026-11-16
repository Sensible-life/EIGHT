import { Text, TextInput } from '../ui/Typography';
import Slider from '@react-native-community/slider';
import { router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, ScrollView, View } from 'react-native';
import { StemPlayer } from '../audio/StemPlayer';
import { renderChoreography } from '../editor/render';
import { clipAt, placeClip, resizeClip, type TimelineClip, type TimelineDraft } from '../editor/timeline';
import { useLibrary } from '../state/LibraryProvider';
import { deleteMedia, resolveMedia } from '../storage/media';
import { C, fmtTime, STEM_LABELS } from '../theme';
import { displayMessage } from '../ui/displayMessage';
import { Button, Card, Empty, Icon, Page, ui } from '../ui/Kit';
import { SectionTitle } from '../ui/ScreenParts';

const PX = 44;
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function PlayingVideo({ uri, offset, playing, rate }: { uri: string; offset: number; playing: boolean; rate: number }) {
  const player = useVideoPlayer(uri, p => { p.muted = true; });
  useEffect(() => {
    try {
      // expo-video exposes playback controls as mutable player properties.
      // eslint-disable-next-line react-hooks/immutability
      player.playbackRate = rate;
      if (Math.abs(player.currentTime - offset) > .3 || !playing) player.seekBy(Math.max(0, offset) - player.currentTime);
      if (playing && !player.playing) player.play();
      if (!playing && player.playing) player.pause();
    } catch { /* A newly mounted video may still be loading. */ }
  }, [player, offset, playing, rate]);
  return <VideoView player={player} nativeControls={false} contentFit="contain" style={{ width: '100%', height: 210 }} />;
}
function Preview({ uri, offset, playing, rate }: { uri?: string; offset: number; playing: boolean; rate: number }) {
  const [source, setSource] = useState<{ key: string; uri: string } | null>(null);
  useEffect(() => {
    if (!uri) return;
    let alive = true, release = () => {};
    void resolveMedia(uri).then(media => { if (!alive) { media.release(); return; } release = media.release; setSource({ key: uri, uri: media.uri }); }).catch(() => { if (alive) setSource(null); });
    return () => { alive = false; release(); };
  }, [uri]);
  return <View style={{ height: 210, backgroundColor: '#171321', borderRadius: 14, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>{uri && source?.key === uri ? <PlayingVideo key={source.uri} uri={source.uri} offset={offset} playing={playing} rate={rate} /> : <Text style={{ color: '#C7BDD0' }}>{uri ? 'Preparing video…' : 'No video at this point'}</Text>}</View>;
}
function TimelineBlock({ clip, selected, title, onSelect, onMove }: { clip: TimelineClip; selected: boolean; title: string; onSelect: () => void; onMove: (time: number) => void }) {
  const callbacks = useRef({ clip, onSelect, onMove });
  useEffect(() => { callbacks.current = { clip, onSelect, onMove }; }, [clip, onSelect, onMove]);
  const [dx, setDx] = useState(0);
  // The responder reads the ref only in gesture callbacks, never during render.
  // eslint-disable-next-line react-hooks/refs
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => callbacks.current.onSelect(),
    onPanResponderMove: (_, gesture) => setDx(gesture.dx),
    onPanResponderRelease: (_, gesture) => { setDx(0); if (Math.abs(gesture.dx) > 3) callbacks.current.onMove(callbacks.current.clip.start + gesture.dx / PX); },
    onPanResponderTerminate: () => setDx(0),
  }), []);
  return <View {...pan.panHandlers} accessibilityRole="button" accessibilityLabel={`${title}, at ${fmtTime(clip.start)}. Select to adjust.`} style={{ position: 'absolute', left: clip.start * PX + dx, width: Math.max(clip.duration * PX, 4), height: 60, top: 3, backgroundColor: selected ? '#9A35D0' : '#C98AE1', borderRadius: 8, borderWidth: selected ? 2 : 1, borderColor: selected ? '#63238E' : '#B874D1', overflow: 'hidden', justifyContent: 'center', paddingHorizontal: 6 }}><Text numberOfLines={1} style={{ color: '#FFF', fontFamily: 'SpaceGrotesk_600SemiBold', fontSize: 12 }}>{title}</Text></View>;
}
export default function Editor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, updateExtras } = useLibrary();
  const project = data.projects.find(p => p.id === id);
  const videos = useMemo(() => (data.extras?.motifs ?? []).filter(m => m.projectId === id && !!m.video), [data.extras?.motifs, id]);
  const draft = data.extras?.timelines.find(t => t.projectId === id);
  const clips = draft?.clips ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null), [time, setTime] = useState(0), [duration, setDuration] = useState(0), [playing, setPlaying] = useState(false), [message, setMessage] = useState(''), [exporting, setExporting] = useState(false);
  const player = useRef<StemPlayer | null>(null), alive = useRef(true);
  const filesKey = JSON.stringify(project?.job.files ?? {});
  useEffect(() => {
    alive.current = true;
    const p = new StemPlayer(); player.current = p;
    let active = true; const releases: (() => void)[] = [];
    void (async () => {
      const files: Record<string, string> = JSON.parse(filesKey);
      const entries = Object.entries(files).filter(([key]) => key !== 'mix');
      if (!entries.length && files.mix) entries.push(['mix', files.mix]);
      const resolved: Record<string, string> = {};
      for (const [name, uri] of entries) { const item = await resolveMedia(uri); if (!active) { item.release(); return; } releases.push(item.release); resolved[name] = item.uri; }
      await p.load(resolved);
      if (active) { setDuration(p.duration); p.onEnded = () => { setPlaying(false); setTime(0); }; }
    })().catch(error => { if (active) setMessage(displayMessage(error)); });
    const timer = setInterval(() => { if (p.playing) setTime(p.position); }, 100);
    return () => { alive.current = false; active = false; clearInterval(timer); void p.dispose(); releases.forEach(release => release()); if (player.current === p) player.current = null; };
  }, [filesKey]);
  useEffect(() => {
    if (!project || !duration || draft) return;
    const latest = videos.filter(v => v.sessionId).sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!latest) return;
    const clip: TimelineClip = { id: uid(), motifId: latest.id, start: latest.start, sourceStart: 0, duration: Math.min(latest.end - latest.start, duration) };
    const placed = placeClip([], clip, latest.start, duration);
    if (!placed) return;
    updateExtras(e => e.timelines.some(t => t.projectId === project.id) ? e : { ...e, timelines: [{ id: `draft-${project.id}`, projectId: project.id, name: project.job.name.replace(/\.[^.]+$/, ''), updatedAt: Date.now(), clips: [placed] }, ...e.timelines] });
  }, [duration, draft, project, updateExtras, videos]);
  const save = (fn: (d: TimelineDraft) => TimelineDraft) => {
    if (!project) return;
    updateExtras(e => {
      const old = e.timelines.find(t => t.projectId === project.id) ?? { id: `draft-${project.id}`, projectId: project.id, name: project.job.name.replace(/\.[^.]+$/, ''), updatedAt: Date.now(), clips: [] };
      const next = { ...fn(old), updatedAt: Date.now() };
      return { ...e, timelines: [next, ...e.timelines.filter(t => t.projectId !== project.id)] };
    });
  };
  const seek = (position: number) => { const next = Math.max(0, Math.min(duration, position)); setTime(next); void player.current?.seek(next); };
  const add = (motifId: string) => {
    const source = videos.find(v => v.id === motifId); if (!source || !duration) return;
    if (clips.length >= 100) { setMessage('A timeline can contain up to 100 clips.'); return; }
    const clip: TimelineClip = { id: uid(), motifId, start: time, sourceStart: 0, duration: Math.min(source.end - source.start, duration) };
    const placed = placeClip(clips, clip, time, duration);
    if (!placed) { setMessage('There is not enough space for this clip. Trim or move another clip first.'); return; }
    save(d => ({ ...d, clips: [...d.clips, placed] })); setSelectedId(placed.id); setMessage('');
  };
  const updateClip = (next: TimelineClip | null) => { if (next) save(d => ({ ...d, clips: d.clips.map(c => c.id === next.id ? next : c) })); };
  const selected = clips.find(c => c.id === selectedId), selectedVideo = videos.find(v => v.id === selected?.motifId);
  const current = clipAt(clips, time), currentVideo = videos.find(v => v.id === current?.motifId);
  const doExport = async () => {
    if (!project || !draft || !clips.length) return;
    if ((data.extras?.finished.length ?? 0) >= 1000) { setMessage('The library has reached its 1,000 finished video limit.'); return; }
    setExporting(true); setMessage('Uploading and rendering MP4. Keep this screen open.');
    try {
      const video = await renderChoreography(data.server, project.job.files ?? {}, clips, videos);
      if (!alive.current) { await deleteMedia(video); return; }
      updateExtras(e => ({ ...e, finished: [{ id: uid(), projectId: project.id, name: draft.name, createdAt: Date.now(), clips: clips.map(c => ({ ...c })), video }, ...e.finished] }));
      setMessage('MP4 saved. Find it in Workspace → Saved.');
    } catch (error) { if (alive.current) setMessage(displayMessage(error)); }
    finally { if (alive.current) setExporting(false); }
  };
  if (!project) return <Page><Empty title="Project not found" detail="Choose a project to edit." action="Workspace" onPress={() => router.replace('/workspace')} /></Page>;
  return <Page>
    <SectionTitle title="Preview" detail="Draft changes are saved automatically." />
    <Preview uri={currentVideo?.video} offset={current ? (currentVideo?.videoOffset ?? 0) + (current.sourceStart + time - current.start) / (currentVideo?.videoRate ?? 1) : 0} rate={1 / (currentVideo?.videoRate ?? 1)} playing={playing} />
    <View style={ui.between}><Pressable accessibilityRole="button" accessibilityLabel={playing ? 'Pause preview' : 'Play preview'} disabled={!duration} onPress={() => { const p = player.current; if (!p) return; if (p.playing) { p.pause(); setPlaying(false); } else void p.play(time >= duration ? 0 : time).then(() => setPlaying(p.playing)); }} style={{ minWidth: 52, minHeight: 44, justifyContent: 'center' }}><Icon name={playing ? 'pause-circle' : 'play-circle'} color={C.accent} size={36} /></Pressable><Text style={ui.small}>{fmtTime(time)} / {fmtTime(duration)}</Text><Text style={ui.small}>Rough preview</Text></View>
    <Slider accessibilityLabel="Preview position" minimumValue={0} maximumValue={duration || 1} value={time} onSlidingComplete={seek} minimumTrackTintColor={C.accent} />
    <Card><View style={ui.between}><Text style={ui.h2}>Timeline</Text><Text style={ui.small}>{clips.length} clips · drag to move</Text></View>
      <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator><View style={{ width: Math.max(duration * PX, 280), gap: 5 }}>
        <View style={{ height: 28, backgroundColor: '#EBD9F3', borderRadius: 7, justifyContent: 'center', paddingHorizontal: 8 }}><Text style={[ui.small, { color: C.accent }]}>♪ MUSIC · {fmtTime(duration)}</Text></View>
        <View style={{ height: 66, backgroundColor: '#F3EDF5', borderRadius: 8 }}><Pressable accessibilityRole="button" accessibilityLabel="Seek on timeline" onPress={e => seek(e.nativeEvent.locationX / PX)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />{clips.map(c => <TimelineBlock key={c.id} clip={c} selected={c.id === selectedId} title={videos.find(v => v.id === c.motifId)?.name ?? 'Video'} onSelect={() => setSelectedId(c.id)} onMove={start => updateClip(placeClip(clips, c, start, duration))} />)}<View pointerEvents="none" style={{ position: 'absolute', left: time * PX, width: 2, height: 66, backgroundColor: '#292036' }} /></View>
      </View></ScrollView>
      {selected && selectedVideo && <View style={{ gap: 7 }}><View style={ui.between}><Text style={ui.h3} numberOfLines={1}>{selectedVideo.name}</Text><Pressable accessibilityRole="button" accessibilityLabel="Remove clip from timeline" onPress={() => { save(d => ({ ...d, clips: d.clips.filter(c => c.id !== selected.id) })); setSelectedId(null); }}><Icon name="trash-outline" color={C.sub} /></Pressable></View><Text style={ui.small}>Position {fmtTime(selected.start)} · Duration {selected.duration.toFixed(1)}s</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}><View style={{ flex: 1 }}><Button title="← 0.5s" secondary onPress={() => updateClip(placeClip(clips, selected, selected.start - .5, duration))} /></View><View style={{ flex: 1 }}><Button title="0.5s →" secondary onPress={() => updateClip(placeClip(clips, selected, selected.start + .5, duration))} /></View></View>
        <Text style={ui.small}>Clip start: {selected.sourceStart.toFixed(1)}s</Text><Slider accessibilityLabel="Trim clip start" minimumValue={0} maximumValue={Math.max(0, selectedVideo.end - selectedVideo.start - .1)} value={selected.sourceStart} step={.1} minimumTrackTintColor={C.accent} onSlidingComplete={v => { const changed = { ...selected, sourceStart: v }; updateClip(resizeClip(clips, changed, selected.duration, selectedVideo.end - selectedVideo.start, duration)); }} />
        <Text style={ui.small}>Clip duration: {selected.duration.toFixed(1)}s</Text><Slider accessibilityLabel="Trim clip duration" minimumValue={.1} maximumValue={Math.max(.1, selectedVideo.end - selectedVideo.start - selected.sourceStart)} value={selected.duration} step={.1} minimumTrackTintColor={C.accent} onSlidingComplete={v => updateClip(resizeClip(clips, selected, v, selectedVideo.end - selectedVideo.start, duration))} />
        <Text style={ui.h3}>Focus layers</Text><Text style={ui.small}>Select the layers you used as a reference for this clip.</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{[...new Set([...(project.job.stems ?? Object.keys(project.job.files ?? {}).filter(key => key !== 'mix')), ...(selected.focusLayers ?? [])])].map(stem => { const marked = selected.focusLayers?.includes(stem) ?? false, disabled = !marked && (selected.focusLayers?.length ?? 0) >= 20; return <Pressable key={stem} accessibilityRole="checkbox" accessibilityState={{ checked: marked, disabled }} disabled={disabled} onPress={() => updateClip({ ...selected, focusLayers: marked ? (selected.focusLayers ?? []).filter(item => item !== stem) : [...(selected.focusLayers ?? []), stem] })} style={{ minHeight: 40, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 10, backgroundColor: marked ? C.cardHi : C.bg, borderWidth: 1, borderColor: marked ? C.accent : C.line, opacity: disabled ? .5 : 1 }}><Text style={marked ? ui.link : ui.small}>{marked ? '✓ ' : ''}{STEM_LABELS[stem] ?? stem}</Text></Pressable>; })}</View>
      </View>}
    </Card>
    <View style={ui.between}><Text style={ui.h2}>Add video</Text><Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/project', params: { id: project.id } })}><Text style={ui.link}>Manage clips</Text></Pressable></View>
    {videos.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>{videos.map(v => <Pressable key={v.id} accessibilityRole="button" disabled={!duration} onPress={() => add(v.id)} style={{ width: 130, padding: 12, minHeight: 85, borderRadius: 12, backgroundColor: C.card, justifyContent: 'space-between' }}><Icon name="add-circle-outline" color={C.accent} /><Text style={ui.h3} numberOfLines={1}>{v.name}</Text><Text style={ui.small}>{fmtTime(v.end - v.start)}</Text></Pressable>)}</ScrollView> : <Text style={ui.body}>Import or record a video in this project first.</Text>}
    <TextInput accessibilityLabel="Finished video name" style={ui.input} placeholder="Video name" value={draft?.name ?? project.job.name.replace(/\.[^.]+$/, '')} onChangeText={name => save(d => ({ ...d, name }))} maxLength={120} />
    <Button title={exporting ? 'Rendering MP4…' : 'Finish and save MP4'} disabled={exporting || !clips.length || !duration || !draft?.name.trim()} icon="download-outline" onPress={() => void doExport()} />
    <Text style={ui.small}>Draft changes save automatically. Export uses the connected server and saves the MP4 on this device.</Text>{!!message && <Text accessibilityLiveRegion="polite" style={ui.body}>{message}</Text>}
  </Page>;
}
