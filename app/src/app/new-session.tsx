import { router } from 'expo-router';
import { Alert, Platform, Text, View } from 'react-native';
import HomeScreen from '../screens/HomeScreen';
import { useLibrary } from '../state/LibraryProvider';
import { C } from '../theme';
import { ui } from '../ui/Kit';
export default function NewSession() {
  const { data, setServer, select } = useLibrary();
  return <View style={{ flex: 1 }}><View style={{ paddingHorizontal: 24, paddingTop: 12, gap: 8 }}><Text style={ui.label}>NEW SESSION</Text><Text style={ui.title}>나의 리듬 시작하기</Text><View style={[ui.row, { paddingVertical: 12 }]}><Text style={{ color: C.accent, fontWeight: '700', fontSize: 12 }}>01 음악 선택</Text><Text style={ui.small}>────</Text><Text style={ui.small}>02 기기 연결</Text><Text style={ui.small}>────</Text><Text style={ui.small}>03 시작</Text></View></View>
    <HomeScreen compact server={data.server} setServer={setServer} onOpen={async job => { try { const id = await select(job, data.server); router.push({ pathname: '/device', params: { project: id } }); } catch (error) { if (Platform.OS === 'web') window.alert(String(error)); else Alert.alert('파일을 저장하지 못했어요', String(error)); } }} />
  </View>;
}
