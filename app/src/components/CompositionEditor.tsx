import { Text, TextInput } from '../ui/Typography';
import CompositionVideo from './CompositionVideo';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLibrary } from '../state/LibraryProvider';
import { C } from '../theme';
import { confirmAction } from '../ui/confirm';
import { Button, Card, Icon, ui } from '../ui/Kit';

export default function CompositionEditor({ projectId }: { projectId?: string }) {
  const { data, updateExtras, start } = useLibrary();
  const [project, setProject] = useState(projectId ?? ''), [chosen, setChosen] = useState<string[]>([]), [name, setName] = useState("My compositions");
  const [building, setBuilding] = useState(false), [expanded, setExpanded] = useState<string | null>(null);
  const motifs = (data.extras?.motifs ?? []).filter(m => !projectId || m.projectId === projectId), compositions = (data.extras?.compositions ?? []).filter(c => !projectId || c.projectId === projectId);
  const reorder = (index: number, direction: number) => setChosen(old => {
    const next = [...old], target = index + direction;
    if (target >= 0 && target < next.length) [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  return <><View style={ui.between}><View><Text style={ui.h3}>My compositions</Text><Text style={ui.small}>{compositions.length} compositions</Text></View><Pressable accessibilityRole="button" accessibilityState={{ expanded: building }} onPress={() => setBuilding(!building)} style={{ minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 14, backgroundColor: C.cardHi }}><Text style={ui.link}>{building ? "Close" : "＋ New composition"}</Text></Pressable></View>
    {building && <Card><Text style={ui.h3}>Create composition</Text><Text style={ui.small}>Select clips from one track and arrange them in order.</Text>
      {!motifs.length && <Text style={ui.body}>Save clips during a session first.</Text>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>{[...new Set(motifs.map(m => m.projectId))].map(id => <Pressable key={id} accessibilityRole="button" accessibilityState={{ selected: project === id }} onPress={() => { setProject(id); setChosen([]); }} style={{ minHeight: 40, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 12, backgroundColor: project === id ? C.cardHi : C.bg }}><Text style={project === id ? ui.link : ui.body}>{data.projects.find(p => p.id === id)?.job.name ?? "Music"}{project === id ? ' ✓' : ''}</Text></Pressable>)}</View>
      {!!project && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>{motifs.filter(m => m.projectId === project).map(m => <Pressable key={m.id} accessibilityRole="button" onPress={() => setChosen(old => old.length < 100 ? [...old, m.id] : old)} style={{ minHeight: 40, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: C.line }}><Text style={ui.link}>＋ {m.name}</Text></Pressable>)}</View>}
      {chosen.map((id, i) => <View key={`${id}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderTopWidth: 1, borderTopColor: C.line }}><Text style={[ui.body, { flex: 1 }]} numberOfLines={2}>{i + 1}. {motifs.find(m => m.id === id)?.name}</Text><Pressable accessibilityRole="button" accessibilityLabel={`${i + 1} clip: move up`} onPress={() => reorder(i, -1)} style={{ padding: 10, minHeight: 44 }}><Text style={ui.link}>↑</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`${i + 1} clip: move down`} onPress={() => reorder(i, 1)} style={{ padding: 10, minHeight: 44 }}><Text style={ui.link}>↓</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`${i + 1} clip: remove`} onPress={() => setChosen(old => old.filter((_, j) => j !== i))} style={{ padding: 10, minHeight: 44 }}><Icon name="close" size={18} color={C.dim} /></Pressable></View>)}
      <TextInput accessibilityLabel={"Composition name"} value={name} onChangeText={setName} maxLength={100} style={ui.input} /><Button title={"Save composition"} disabled={!chosen.length || !name.trim()} onPress={() => { updateExtras(e => ({ ...e, compositions: [{ id: `composition-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, projectId: project, name: name.trim(), motifIds: chosen, createdAt: Date.now() }, ...e.compositions].slice(0, 1000) })); setChosen([]); setBuilding(false); }} /></Card>}
    {compositions.map(c => <Card key={c.id}><Pressable accessibilityRole="button" accessibilityState={{ expanded: expanded === c.id }} onPress={() => setExpanded(expanded === c.id ? null : c.id)} style={[ui.row, { minHeight: 44 }]}><View style={ui.iconCircle}><Icon name="layers-outline" color={C.accent} /></View><View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} style={ui.h3}>{c.name}</Text><Text style={ui.small}>{data.projects.find(p => p.id === c.projectId)?.job.name} · {c.motifIds.length} clips</Text></View><Icon name={expanded === c.id ? 'chevron-up' : 'chevron-down'} color={C.dim} size={18} /></Pressable>
      {expanded === c.id && <>{c.motifIds.map((id, i) => <Text key={`${id}-${i}`} style={ui.small}>{i + 1}. {motifs.find(m => m.id === id)?.name}</Text>)}<CompositionVideo motifs={c.motifIds.map(id => motifs.find(m => m.id === id)).filter((m): m is NonNullable<typeof m> => !!m)} /><View style={{ flexDirection: 'row', gap: 8 }}><View style={{ flex: 2 }}><Button title={"Resume practice"} onPress={() => router.push({ pathname: '/session', params: { id: start(c.projectId, undefined, undefined, c.id) } })} /></View><View style={{ flex: 1 }}><Button title={"Delete"} secondary onPress={() => confirmAction("Delete composition", "Delete this composition. Saved movements will remain.", () => updateExtras(e => ({ ...e, compositions: e.compositions.filter(x => x.id !== c.id) })))} /></View></View></>}
    </Card>)}
    {!compositions.length && !building && <Card><Text style={ui.body}>No saved compositions.</Text></Card>}
  </>;
}
