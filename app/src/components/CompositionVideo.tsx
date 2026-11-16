import { Text } from '../ui/Typography';
import { displayMessage } from '../ui/displayMessage';
import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { Motif } from '../state/extras';
import { resolveMedia } from '../storage/media';
import { Button, ui } from '../ui/Kit';

function PlayingClip({ uri, onEnd }: { uri: string; onEnd: () => void }) {
  const player = useVideoPlayer(uri, p => { p.muted = true; p.play(); });
  useEventListener(player, 'playToEnd', onEnd);
  return <VideoView player={player} nativeControls style={{ width: '100%', height: 220, borderRadius: 18 }} />;
}
export default function CompositionVideo({ motifs }: { motifs: Motif[] }) {
  const [index, setIndex] = useState(-1), [uri, setUri] = useState(''), [error, setError] = useState('');
  const clips = motifs.filter((m): m is Motif & { video: string } => !!m.video);
  const current = clips[index];
  useEffect(() => {
    if (!current) return;
    let alive = true, release = () => {};
    void resolveMedia(current.video).then(m => { if (!alive) { m.release(); return; } release = m.release; setUri(m.uri); }).catch(e => { if (alive) setError(displayMessage(e)); });
    return () => { alive = false; release(); };
  }, [current]);
  if (!clips.length) return null;
  const advance = () => { setUri(''); setIndex(i => i + 1 < clips.length ? i + 1 : -1); };
  return <View style={{ gap: 8 }}><Text style={ui.small}>Video {clips.length} clips · played in saved order. Play music separately in practice.</Text>
    {current && uri && <><Text style={ui.body}>{index + 1} / {clips.length} · {current.name}</Text><PlayingClip key={`${index}-${uri}`} uri={uri} onEnd={advance} /></>}
    {index < 0 ? <Button title={"Play movement videos"} secondary onPress={() => { setError(''); setIndex(0); }} /> : <Button title={"Stop playback"} secondary onPress={() => { setUri(''); setIndex(-1); }} />}
    {!!error && <Text style={ui.body}>{error}</Text>}</View>;
}
