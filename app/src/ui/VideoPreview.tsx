import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { resolveMedia } from '../storage/media';
import { ui } from './Kit';
function Video({ uri }: { uri: string }) { const player = useVideoPlayer(uri); return <VideoView player={player} nativeControls style={{ width: '100%', height: 220, borderRadius: 18 }} />; }
export default function VideoPreview({ uri }: { uri: string }) {
  const [source, setSource] = useState(''), [error, setError] = useState('');
  useEffect(() => { let alive = true, release = () => {}; void resolveMedia(uri).then(media => { if (!alive) { media.release(); return; } release = media.release; setSource(media.uri); }).catch(e => { if (alive) setError(String(e)); }); return () => { alive = false; release(); }; }, [uri]);
  return source ? <Video key={source} uri={source} /> : <Text style={ui.small}>{error || '영상 준비 중…'}</Text>;
}
