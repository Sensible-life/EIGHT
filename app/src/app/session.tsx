import { displayMessage } from '../ui/displayMessage';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Job } from '../api';
import { discardTemporaryVideo, resolveMedia, saveMedia } from '../storage/media';
import PlayerScreen from '../screens/PlayerScreen';
import { useLibrary } from '../state/LibraryProvider';
import { PlaybackSnapshot } from '../state/model';
import { Empty, Page } from '../ui/Kit';
export default function SessionRoute() {
  const { id } = useLocalSearchParams<{ id: string }>(); const { data, checkpoint, updateExtras } = useLibrary();
  const session = data.sessions.find(s => s.id === id); const project = data.projects.find(p => p.id === session?.projectId);
  const [initial] = useState(session);
  const [resolved, setResolved] = useState<Job | null>(null), [error, setError] = useState('');
  useEffect(() => { let alive = true; const releases: (() => void)[] = [];
    (async () => { if (!project) return; try { const files: Record<string, string> = {}; for (const [stem, uri] of Object.entries(project.job.files ?? {})) { const media = await resolveMedia(uri); if (!alive) { media.release(); return; } releases.push(media.release); files[stem] = media.uri; } if (alive) setResolved({ ...project.job, files }); } catch (e) { if (alive) setError(displayMessage(e)); } })();
    return () => { alive = false; releases.forEach(fn => fn()); };
  }, [project]);
  const snapshot = useCallback((value: PlaybackSnapshot) => checkpoint(id, value), [checkpoint, id]);
  const finish = useCallback((value: PlaybackSnapshot) => { checkpoint(id, value, true); router.replace('/workspace'); }, [checkpoint, id]);
  if (!session || !project) return <Page><Empty title={"Reopen the session"} detail={"Choose music from your workspace."} action={"Workspace"} onPress={() => router.replace('/workspace')} /></Page>;
  if (!resolved || error) return <Page><Empty title={error ? "Check your music files" : "Preparing saved files"} detail={error || "Loading layers saved on this device."} action={"Back to project"} onPress={() => router.replace({ pathname: '/project', params: { id: project.id } })} /></Page>;
  return <PlayerScreen onSaveVideo={async (uri, start, end, mix, videoOffset, videoRate) => {
    const video = await saveMedia(uri, '.mp4');
    updateExtras(e => ({ ...e, motifs: [{ id: `video-${Date.now()}-${Math.random().toString(36).slice(2,8)}`, projectId: project.id, sessionId: id, name: `${project.job.name} · movement video`, createdAt: Date.now(), start, end, eightIndex: null, mix, video, videoOffset, videoRate }, ...e.motifs].slice(0, 1000) }));
    try { discardTemporaryVideo(uri); } catch {}
  }} onSaveMotif={motif => updateExtras(e => ({ ...e, motifs: [{ ...motif, id: `motif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, projectId: project.id, sessionId: id, name: `${project.job.name} · ${motif.eightIndex !== null ? `#${motif.eightIndex + 1} ` : ''}8-count`, createdAt: Date.now() }, ...e.motifs].slice(0, 1000) }))} key={id} server={project.server} job={resolved} missionTitle={session.missionTitle} initialSnapshot={initial} onSnapshot={snapshot} onFinish={finish} onBack={() => router.replace('/')} />;
}
