import { displayMessage } from '../ui/displayMessage';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Platform, View } from 'react-native';
import HomeScreen from '../screens/HomeScreen';
import { useLibrary } from '../state/LibraryProvider';
export default function NewSession() {
  const { data, setServer, select, start } = useLibrary();
  const { missionId, missionTitle } = useLocalSearchParams<{ missionId?: string; missionTitle?: string }>();
  return <View style={{ flex: 1 }}>
    <HomeScreen compact server={data.server} setServer={setServer} onOpen={async job => { try { const id = await select(job, data.server); const mission = missionId && missionTitle ? { id: missionId, title: missionTitle } : undefined; router.push({ pathname: '/session', params: { id: start(id, undefined, undefined, undefined, mission) } }); } catch (error) { if (Platform.OS === 'web') window.alert(displayMessage(error)); else Alert.alert("Could not save the file", displayMessage(error)); } }} />
  </View>;
}
