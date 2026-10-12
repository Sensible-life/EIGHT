import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Job } from '../api';
import { resolveMedia } from '../storage/media';
import PlayerScreen from '../screens/PlayerScreen';
import { useLibrary } from '../state/LibraryProvider';
import { PlaybackSnapshot } from '../state/model';
import { Empty, Page } from '../ui/Kit';
export default function SessionRoute() {
  const { id } = useLocalSearchParams<{ id: string }>(); const { data, checkpoint } = useLibrary();
  const session = data.sessions.find(s => s.id === id); const project = data.projects.find(p => p.id === session?.projectId);
  const [initial] = useState(session);
  const [resolved, setResolved] = useState<Job | null>(null), [error, setError] = useState('');
  useEffect(() => { let alive = true; const releases: (() => void)[] = [];
    (async () => { if (!project) return; try { const files: Record<string, string> = {}; for (const [stem, uri] of Object.entries(project.job.files ?? {})) { const media = await resolveMedia(uri); if (!alive) { media.release(); return; } releases.push(media.release); files[stem] = media.uri; } if (alive) setResolved({ ...project.job, files }); } catch (e) { if (alive) setError(String(e)); } })();
    return () => { alive = false; releases.forEach(fn => fn()); };
  }, [project]);
  const snapshot = useCallback((value: PlaybackSnapshot) => checkpoint(id, value), [checkpoint, id]);
  const finish = useCallback((value: PlaybackSnapshot) => { checkpoint(id, value, true); router.replace('/workspace'); }, [checkpoint, id]);
  if (!session || !project) return <Page><Empty title="세션을 다시 열어주세요" detail="워크스페이스에서 음악을 선택해 주세요." action="워크스페이스" onPress={() => router.replace('/workspace')} /></Page>;
  if (!resolved || error) return <Page><Empty title={error ? '음악 파일을 확인해 주세요' : '저장된 파일 준비 중'} detail={error || '기기에 저장한 레이어를 불러옵니다.'} action="프로젝트로 돌아가기" onPress={() => router.replace({ pathname: '/project', params: { id: project.id } })} /></Page>;
  return <PlayerScreen key={id} server={project.server} job={resolved} initialSnapshot={initial} onSnapshot={snapshot} onFinish={finish} onBack={() => router.replace('/')} />;
}
