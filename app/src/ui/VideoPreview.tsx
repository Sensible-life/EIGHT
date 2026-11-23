import { Text } from './Typography';
import { displayMessage } from './displayMessage';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';

import { resolveMedia } from '../storage/media';
import { ui } from './Kit';
function Video({ uri }: { uri: string }) { const player = useVideoPlayer(uri); return <VideoView player={player} nativeControls style={{ width: '100%', height: 220, borderRadius: 18 }} />; }
export default function VideoPreview({ uri }: { uri: string }) {
  const [resolved, setResolved] = useState<{ input: string; source: string } | null>(null), [failure, setFailure] = useState<{ input: string; message: string } | null>(null);
  useEffect(() => { let alive = true, release = () => {}; void resolveMedia(uri).then(media => { if (!alive) { media.release(); return; } release = media.release; setResolved({ input: uri, source: media.uri }); }).catch(e => { if (alive) setFailure({ input: uri, message: displayMessage(e) }); }); return () => { alive = false; release(); }; }, [uri]);
  const source = resolved?.input === uri ? resolved.source : null;
  const error = failure?.input === uri ? failure.message : null;
  return source ? <Video key={source} uri={source} /> : <Text style={ui.small}>{error || "Preparing video…"}</Text>;
}
