import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useLibrary } from '../state/LibraryProvider';
import { Empty, Page } from '../ui/Kit';

/** Redirect older links to the session without requiring a device setup step. */
export default function DeviceRedirect() {
  const { project, resume, motif, composition } = useLocalSearchParams<{ project?: string; resume?: string; motif?: string; composition?: string }>();
  const { data, pending, ready, start } = useLibrary();
  const projectId = project ?? pending;
  const exists = data.projects.some(item => item.id === projectId);
  const redirected = useRef(false);
  useEffect(() => {
    if (!ready || !projectId || !exists || redirected.current) return;
    redirected.current = true;
    router.replace({ pathname: '/session', params: { id: start(projectId, resume, motif, composition) } });
  }, [ready, projectId, exists, start, resume, motif, composition]);
  if (ready && !exists) return <Page><Empty title="Select music first" detail="Choose music before starting a session." action="Choose music" onPress={() => router.replace('/new-session')} /></Page>;
  return null;
}
