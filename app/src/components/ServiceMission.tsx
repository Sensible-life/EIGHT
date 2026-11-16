import { Text } from '../ui/Typography';
import { displayMessage } from '../ui/displayMessage';
import { useCallback, useEffect, useState } from 'react';

import { useService } from '../service/ServiceProvider';
import { useLibrary } from '../state/LibraryProvider';
import { Button, Card, ui } from '../ui/Kit';
import { C } from '../theme';
type Mission = { week: string; title: string; goal: number; joined: boolean; joinedAt: number | null; progress: number };
export default function ServiceMission({ dark = false }: { dark?: boolean }) {
  const { account, request } = useService(), { data } = useLibrary();
  const [mission, setMission] = useState<Mission | null>(null), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => { setMission(await request<Mission>('/mission')); }, [request]);
  useEffect(() => { if (!account) return; let alive = true; void Promise.resolve().then(refresh).catch(e => { if (alive) setMessage(displayMessage(e)); }); return () => { alive = false; }; }, [account, refresh]);
  if (!account) return null;
  const run = async (fn: () => Promise<void>, success: string) => { setBusy(true); try { await fn(); await refresh(); setMessage(success); } catch (e) { setMessage(displayMessage(e)); } finally { setBusy(false); } };
  return <Card style={dark ? { backgroundColor: C.missionSurface } : undefined}><Text style={[ui.h3, dark && { color: '#FFF' }]}>
Server weekly mission</Text>{mission ? <><Text style={[ui.body, dark && { color: '#D3C9D5' }] }>{mission.title === '나만의 리듬 연습' ? 'Rhythm practice' : mission.title} · {Math.min(mission.progress, mission.goal)} / {mission.goal}</Text>
    {!mission.joined ? <Button title={"Join server mission"} disabled={busy} onPress={() => void run(async () => { await request('/mission/join','POST'); }, "Joined. Sessions started from now on will count.")} /> : <Button title={"Submit completed sessions"} secondary disabled={busy} onPress={() => void run(async () => {
      const completed = data.sessions.filter(s => s.endedAt && s.listened >= 30 && s.startedAt / 1000 >= (mission.joinedAt ?? Infinity));
      if (!completed.length) throw new Error("No completed sessions played for at least 30 seconds after joining.");
      for (const s of completed) await request('/mission/complete','POST',{ session_id: s.id, seconds: s.listened, started_at: s.startedAt / 1000 });
    }, "Completed sessions submitted.")} />}</> : <Text style={[ui.body, dark && { color: '#D3C9D5' }] }>Loading server mission</Text>}
    <Text style={[ui.small, dark && { color: '#AAA0AD' }] }>The server provides missions and receives completed sessions from this device.</Text>{!!message && <Text accessibilityLiveRegion="polite" style={ui.body}>{message}</Text>}</Card>;
}
