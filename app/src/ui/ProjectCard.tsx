import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useLibrary } from '../state/LibraryProvider';
import { Project } from '../state/model';
import { C } from '../theme';
import { Icon, ui } from './Kit';
export function ProjectCard({ project }: { project: Project }) {
  const { choose, toggleSaved } = useLibrary();
  const open = () => { choose(project.id); router.push({ pathname: '/project', params: { id: project.id } }); };
  return <View style={[ui.card, { padding: 18 }]}><View style={ui.row}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${project.job.name} 프로젝트 열기`} onPress={open} style={[ui.row, { flex: 1 }]}><View style={[ui.iconCircle, { width: 56, height: 64, borderRadius: 16 }]}><Icon name="musical-notes" color={C.accent} size={26} /></View><View style={{ flex: 1, gap: 6 }}><Text numberOfLines={1} style={ui.h3}>{project.job.name.replace(/\.[^.]+$/, '')}</Text><Text style={ui.small}>{project.job.stems?.length ?? 0} LAYERS · {project.job.tempo ? `${Math.round(project.job.tempo)} BPM` : '나의 음악'}</Text></View></Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={project.saved ? '저장 해제' : '프로젝트 저장'} accessibilityState={{ selected: project.saved }} onPress={() => toggleSaved(project.id)} style={{ padding: 10 }}><Icon name={project.saved ? 'bookmark' : 'bookmark-outline'} color={project.saved ? C.accent : C.dim} size={21} /></Pressable>
  </View></View>;
}
