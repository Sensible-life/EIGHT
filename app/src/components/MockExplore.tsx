import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, PanResponder, Pressable, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useLibrary } from '../state/LibraryProvider';
import { C } from '../theme';
import { Icon } from '../ui/Kit';
import { Text } from '../ui/Typography';
import MissionTopTabs from './MissionTopTabs';

type Item = { id: string; title: string };
type FeedItem = Item & { key: string };
const CYCLES = 101, CENTER = 50;
const EMPTY: string[] = [];

const videoTime = (seconds: number) => {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
};

function VideoProgress({ position, duration, active, onBegin, onPreview, onSeek, onCancel }: { position: number; duration: number; active: boolean; onBegin: () => void; onPreview: (value: number) => void; onSeek: (value: number) => void; onCancel: () => void }) {
  const callbacks = useRef({ duration, active, onBegin, onPreview, onSeek, onCancel });
  const width = useRef(0), start = useRef(0), last = useRef(0);
  useEffect(() => { callbacks.current = { duration, active, onBegin, onPreview, onSeek, onCancel }; }, [duration, active, onBegin, onPreview, onSeek, onCancel]);
  // Gesture callbacks read the latest values only after a touch event.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const pan = useMemo(() => {
    const valueAt = (x: number) => Math.max(0, Math.min(1, x / Math.max(1, width.current))) * callbacks.current.duration;
    // The responder only reads refs inside gesture callbacks.
    // eslint-disable-next-line react-hooks/refs
    return PanResponder.create({
      onStartShouldSetPanResponder: () => callbacks.current.active && callbacks.current.duration > 0,
      onMoveShouldSetPanResponder: (_, gesture) => callbacks.current.active && callbacks.current.duration > 0 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderGrant: event => { start.current = event.nativeEvent.locationX; last.current = valueAt(start.current); callbacks.current.onBegin(); callbacks.current.onPreview(last.current); },
      onPanResponderMove: (_, gesture) => { last.current = valueAt(start.current + gesture.dx); callbacks.current.onPreview(last.current); },
      onPanResponderRelease: () => callbacks.current.onSeek(last.current),
      onPanResponderTerminate: () => callbacks.current.onCancel(),
    });
  }, []);
  const progress = duration > 0 ? Math.max(0, Math.min(1, position / duration)) : 0;
  return <View {...pan.panHandlers} accessible accessibilityRole="adjustable" accessibilityLabel="Video position" accessibilityValue={{ min: 0, max: Math.round(duration), now: Math.round(position), text: `${videoTime(position)} of ${videoTime(duration)}` }} accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]} onAccessibilityAction={event => { const delta = event.nativeEvent.actionName === 'increment' ? 5 : -5; if (active && duration > 0) onSeek(Math.max(0, Math.min(duration, position + delta))); }} onLayout={event => { width.current = event.nativeEvent.layout.width; }} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 32, justifyContent: 'flex-end' }}><View pointerEvents="none" style={{ height: 2, width: '100%', backgroundColor: '#FFFFFF55' }}><View style={{ height: 2, width: `${progress * 100}%`, backgroundColor: '#ED32C6' }} /></View></View>;
}

const Clip = memo(function Clip({ uri, active }: { uri: string; active: boolean }) {
  const player = useVideoPlayer(uri, p => { p.loop = true; p.timeUpdateEventInterval = 0.25; });
  const [paused, setPaused] = useState(false), [duration, setDuration] = useState(0), [position, setPosition] = useState(0);
  const dragging = useRef(false);
  useEffect(() => { if (active && !paused) player.play(); else player.pause(); }, [active, paused, player]);
  useEffect(() => {
    const refreshDuration = () => { const value = player.duration; if (Number.isFinite(value) && value > 0) setDuration(value); };
    const status = player.addListener('statusChange', refreshDuration);
    const loaded = player.addListener('sourceLoad', ({ duration: value }) => { if (Number.isFinite(value) && value > 0) setDuration(value); });
    const time = player.addListener('timeUpdate', ({ currentTime }) => { if (!dragging.current && Number.isFinite(currentTime)) setPosition(Math.max(0, currentTime)); });
    refreshDuration();
    return () => { status.remove(); loaded.remove(); time.remove(); };
  }, [player]);
  const seek = (value: number) => { const target = Math.max(0, Math.min(duration, value)); player.seekBy(target - player.currentTime); setPosition(target); dragging.current = false; };
  return <View style={{ flex: 1, backgroundColor: '#000' }}>
    <VideoView player={player} nativeControls={false} contentFit="contain" surfaceType="textureView" style={{ flex: 1 }} />
    <Pressable accessibilityRole="button" accessibilityLabel={paused ? 'Play video' : 'Pause video'} onPress={() => setPaused(value => !value)} style={{ position: 'absolute', top: 0, bottom: 48, left: 0, right: 60, alignItems: 'center', justifyContent: 'center' }}>{paused && <Icon name="play-circle" color="#FFFFFF" size={54} />}</Pressable>
    <VideoProgress position={position} duration={duration} active={active} onBegin={() => { dragging.current = true; }} onPreview={setPosition} onSeek={seek} onCancel={() => { dragging.current = false; }} />
  </View>;
});

export default function MockExplore({ onMyMissions }: { onMyMissions: () => void }) {
  const { data, updateExtras } = useLibrary();
  const [items, setItems] = useState<Item[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  const [height, setHeight] = useState(0), [activeIndex, setActiveIndex] = useState(0), [focused, setFocused] = useState(false), [savedOnly, setSavedOnly] = useState(false);
  const ref = useRef<FlatList<FeedItem>>(null);
  const scrollIndex = useRef<number | null>(null);
  const base = data.server.trim().replace(/\/$/, '');
  const liked = data.extras?.exploreLiked ?? EMPTY, saved = data.extras?.exploreSaved ?? EMPTY;
  const keyFor = useCallback((id: string) => `${base}::${id}`, [base]);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) { setLoading(true); setError(''); } });
    void fetch(`${base}/mock/explore`).then(response => { if (!response.ok) throw new Error('Server unavailable'); return response.json() as Promise<unknown>; }).then(result => {
      if (!Array.isArray(result) || !result.every(item => item && typeof item.id === 'string' && /^[a-f0-9]{24}$/.test(item.id) && typeof item.title === 'string')) throw new Error('Invalid response');
      if (active) { setItems(result); setActiveIndex(result.length * CENTER); }
    }).catch(() => { if (active) { setItems([]); setError('Could not load videos. Check the server connection.'); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [base, retry]);
  const visible = useMemo(() => savedOnly ? items.filter(item => saved.includes(keyFor(item.id))) : items, [items, savedOnly, saved, keyFor]);
  const feed = useMemo(() => Array.from({ length: CYCLES }, (_, cycle) => visible.map(item => ({ ...item, key: `${cycle}:${item.id}` }))).flat(), [visible]);
  const startIndex = visible.length * CENTER;
  const toggle = (field: 'exploreLiked' | 'exploreSaved', id: string) => updateExtras(extras => {
    const values = extras[field], key = keyFor(id);
    return { ...extras, [field]: values.includes(key) ? values.filter(value => value !== key) : [...values, key].slice(-1000) };
  });
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!height) return;
    const index = Math.max(0, Math.min(feed.length - 1, Math.round(event.nativeEvent.contentOffset.y / height)));
    if (scrollIndex.current !== index) { scrollIndex.current = index; setActiveIndex(index); }
  };
  const settle = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!height || !visible.length) return;
    const index = Math.max(0, Math.min(feed.length - 1, Math.round(event.nativeEvent.contentOffset.y / height)));
    if (index < visible.length * 2 || index >= visible.length * (CYCLES - 2)) {
      const next = startIndex + index % visible.length;
      scrollIndex.current = next; ref.current?.scrollToOffset({ offset: next * height, animated: false }); setActiveIndex(next);
    } else setActiveIndex(index);
  };
  return <View style={{ flex: 1, backgroundColor: '#000' }}>
    <View style={{ flex: 1, overflow: 'hidden' }} onLayout={event => { const next = event.nativeEvent.layout.height; if (next > 0 && next !== height) setHeight(next); }}>
      {loading ? <ActivityIndicator style={{ flex: 1 }} color={C.accent} /> : error || !visible.length ? <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 }}><Text style={{ color: '#DDD1E0', textAlign: 'center' }}>{error || (savedOnly ? 'No saved videos yet.' : 'Add MP4 videos to the mock videos folder.')}</Text>{savedOnly && !error && <Pressable accessibilityRole="button" onPress={() => { setActiveIndex(items.length * CENTER); setSavedOnly(false); }} style={{ padding: 12 }}><Text style={{ color: '#FFF' }}>Show all</Text></Pressable>}{!!error && <Pressable accessibilityRole="button" onPress={() => setRetry(n => n + 1)} style={{ padding: 12 }}><Text style={{ color: '#F078EF' }}>Retry</Text></Pressable>}</View> : height > 0 && <FlatList key={`${savedOnly}:${height}:${visible.map(x => x.id).join(',')}`} ref={ref} data={feed} keyExtractor={item => item.key} initialScrollIndex={startIndex} getItemLayout={(_, index) => ({ length: height, offset: height * index, index })} pagingEnabled decelerationRate="fast" showsVerticalScrollIndicator={false} windowSize={3} initialNumToRender={3} maxToRenderPerBatch={3} updateCellsBatchingPeriod={20} removeClippedSubviews={true} onScroll={onScroll} scrollEventThrottle={32} onMomentumScrollEnd={settle} renderItem={({ item, index }) => {
        const itemKey = keyFor(item.id), isLiked = liked.includes(itemKey), isSaved = saved.includes(itemKey);
        return <View style={{ height, backgroundColor: '#000', overflow: 'hidden' }}>{focused && Math.abs(activeIndex - index) <= 1 && <Clip uri={`${base}/mock/explore/${item.id}`} active={activeIndex === index} />}<View pointerEvents="box-none" style={{ position: 'absolute', bottom: 60, left: 18, right: 18, flexDirection: 'row', alignItems: 'flex-end', gap: 12 }}><View style={{ flex: 1, gap: 5 }}><Text numberOfLines={2} style={{ color: '#FFF', fontSize: 19, fontFamily: 'SpaceGrotesk_600SemiBold', textShadowColor: '#000', textShadowRadius: 5 }}>{item.title}</Text><Text style={{ color: '#EADFEB', fontSize: 11 }}>Mock reference</Text><Pressable accessibilityRole="button" accessibilityLabel={savedOnly ? 'Show all videos' : 'Show saved videos'} accessibilityState={{ selected: savedOnly }} onPress={() => { setActiveIndex((savedOnly ? items.length : items.filter(item => saved.includes(keyFor(item.id))).length) * CENTER); setSavedOnly(value => !value); }} style={{ minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center' }}><Text style={{ color: '#FFF', fontSize: 12 }}>{savedOnly ? 'Show all' : 'Saved videos'}</Text></Pressable></View><View style={{ gap: 10, alignItems: 'center' }}><Pressable accessibilityRole="button" accessibilityLabel={isLiked ? 'Unlike video' : 'Like video'} accessibilityState={{ selected: isLiked }} onPress={() => toggle('exploreLiked', item.id)} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24, backgroundColor: '#21172C99' }}><Icon name={isLiked ? 'heart' : 'heart-outline'} size={28} color={isLiked ? '#F05BCF' : '#FFF'} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel={isSaved ? 'Remove saved video' : 'Save video'} accessibilityState={{ selected: isSaved }} onPress={() => { if (savedOnly && isSaved) setActiveIndex(Math.max(0, visible.length - 1) * CENTER); toggle('exploreSaved', item.id); }} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24, backgroundColor: '#21172C99' }}><Icon name={isSaved ? 'bookmark' : 'bookmark-outline'} size={26} color={isSaved ? '#F05BCF' : '#FFF'} /></Pressable></View></View></View>;
      }} />}
    </View>
    <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#00000044' }}>
      <MissionTopTabs selected="explore" onChange={value => { if (value === 'missions') onMyMissions(); }} />

    </View>
  </View>;
}
