import { Text } from './Typography';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useLibrary } from '../state/LibraryProvider';
import { Project } from '../state/model';
import { C } from '../theme';
import { Icon, ui } from './Kit';
export function ProjectCard({ project, tile = false }: { project: Project; tile?: boolean }) {
  const { choose, data } = useLibrary();
  const mission = data.sessions.find(session => session.projectId === project.id && session.missionTitle && !session.endedAt);
  const open = () => { choose(project.id); router.push({ pathname: '/project', params: { id: project.id } }); };
  return <View style={[ui.card, { padding: 14, borderRadius: 16, minHeight: tile ? 132 : undefined, borderWidth: 1, borderColor: C.line }]}><View style={[ui.row, tile && { flexDirection: 'column', alignItems: 'stretch' }]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${project.job.name} open project`} onPress={open} style={[ui.row, { flex: 1 }, tile && { flexDirection: 'column', alignItems: 'stretch', gap: 9 }]}><View style={[ui.iconCircle, { width: 40, height: 40, borderRadius: 13 }]}><Icon name="musical-notes" color={C.accent} size={20} /></View><View style={{ flex: 1, minWidth: 0, gap: 3 }}><Text numberOfLines={tile ? 2 : 1} style={ui.h3}>{project.job.name.replace(/\.[^.]+$/, '')}</Text><Text style={ui.small}>{project.job.stems?.length ?? 0} layers{project.job.tempo ? ` · ${Math.round(project.job.tempo)} BPM` : ''}</Text>{mission && <Text style={ui.link} numberOfLines={1}>Mission · {mission.missionTitle}</Text>}</View></Pressable>

  </View></View>;
}
