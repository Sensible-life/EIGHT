import { Text, TextInput } from '../ui/Typography';
import { displayMessage } from '../ui/displayMessage';
import AccountCard from '../components/AccountCard';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import PoseCameraView from '../../modules/pose-camera';
import WatchNative from '../../modules/watch-haptics';
import { exportBackup } from '../storage/backup';
import { mediaUsage, readTextFile } from '../storage/media';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, View } from 'react-native';
import { api } from '../api';
import { useLibrary } from '../state/LibraryProvider';
import { useDevice } from '../state/DeviceProvider';
import { C } from '../theme';
import { Button, Page, ui } from '../ui/Kit';
import { SectionTitle, SettingsItem } from '../ui/ScreenParts';
export default function Settings() {
  const { data, setServer, restore } = useLibrary(); const [draft, setDraft] = useState(data.server), [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
  const { connected, connecting, status: watchStatus, ensureWatch, reportWatchError } = useDevice();
  const [camera, setCamera] = useState<{ granted: boolean; canAskAgain: boolean } | null>(null);
  const checkCamera = useCallback(async () => { if (!PoseCameraView) return; try { const result = await ImagePicker.getCameraPermissionsAsync(); setCamera({ granted: result.granted, canAskAgain: result.canAskAgain }); } catch (error) { setStatus(displayMessage(error)); } }, []);
  useEffect(() => { void Promise.resolve().then(checkCamera); const sub = AppState.addEventListener('change', state => { if (state === 'active') void checkCamera(); }); return () => sub.remove(); }, [checkCamera]);
  const allowCamera = async () => { try { if (camera && !camera.canAskAgain) { await Linking.openSettings(); return; } const result = await ImagePicker.requestCameraPermissionsAsync(); setCamera({ granted: result.granted, canAskAgain: result.canAskAgain }); } catch (error) { setStatus(displayMessage(error)); } };
  const save = async () => { const url = draft.trim().replace(/\/$/, ''); if (!/^https?:\/\/[^\s]+$/.test(url)) { setStatus("Enter a server address starting with http:// or https://."); return; } setServer(url); setBusy(true); try { const health = await api.health(url); setStatus(health.providers?.lalal?.ready ? "Server connected · LALAL.AI available" : "Server connected · LALAL.AI API key required"); } catch { setStatus("Address saved. Check that the server is running and both devices share a Wi-Fi network."); } finally { setBusy(false); } };
  const backup = async () => { try { await exportBackup(data); setStatus("Backup export requested. Check the downloaded or shared file. Music and videos are not included."); } catch (e) { setStatus(displayMessage(e)); } };
  const importBackup = async () => { try { const r = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain'], copyToCacheDirectory: true }); if (r.canceled) return; restore(await readTextFile(r.assets[0].uri)); setStatus("Backup merged with existing records."); } catch (e) { setStatus(displayMessage(e)); } };
  return <Page>
    <SectionTitle title="Your devices" detail="Connections and permissions" />
    <SettingsItem title="Devices" detail="Watch · camera · audio" icon="hardware-chip-outline">
      <Text style={ui.h3}>Galaxy Watch</Text><Text style={ui.body}>{WatchNative ? watchStatus : 'Watch connection is available in the Android app.'}</Text>
      {!!WatchNative && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><View style={{ flexGrow: 1 }}><Button title={connecting ? 'Connecting…' : connected ? 'Connected ✓' : 'Connect watch'} disabled={connecting || connected} secondary onPress={() => void ensureWatch()} /></View>{connected && <View style={{ flexGrow: 1 }}><Button title="Test vibration" secondary onPress={() => void WatchNative?.test().catch(reportWatchError)} /></View>}</View>}
      <View style={ui.line} /><Text style={ui.h3}>Camera</Text><Text style={ui.body}>{!PoseCameraView ? 'Motion camera is available in the Android app.' : camera?.granted ? 'Camera access is enabled.' : 'Allow camera access for motion tracking and recording.'}</Text>
      {!!PoseCameraView && !camera?.granted && <Button title={camera && !camera.canAskAgain ? 'Open system settings' : 'Allow camera access'} secondary onPress={() => void allowCamera()} />}
      <View style={ui.line} /><Text style={ui.h3}>Audio output</Text><Text style={ui.body}>Connect an amplifier by audio cable or Bluetooth.</Text>
    </SettingsItem>
    <SectionTitle title="App settings" />
    <SettingsItem title={"Account and sync"} detail={"Sign in · Save records to server"} icon="person-circle-outline"><AccountCard embedded /></SettingsItem>
    <SettingsItem title={"Audio separation server"} detail={"Address and connection status"} icon="cloud-outline"><Text style={ui.body}>Enter the address of the server running on your Mac.</Text><TextInput accessibilityLabel={"Server address"} value={draft} onChangeText={setDraft} placeholder="http://192.168.0.10:8000" placeholderTextColor={C.dim} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={ui.input} /><Button title={busy ? "Checking…" : "Save and check connection"} onPress={save} disabled={busy} /></SettingsItem>
    <SettingsItem title={"Backup"} detail={"Export or import JSON"} icon="archive-outline"><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><View style={{ flexGrow: 1 }}><Button title={"Export"} onPress={() => void backup()} secondary /></View><View style={{ flexGrow: 1 }}><Button title={"Import and merge"} onPress={() => void importBackup()} secondary /></View></View><Text style={ui.small}>Includes records and settings only; music and video files are excluded.</Text></SettingsItem>
    <SettingsItem title={"Storage"} detail={"Music and videos saved on this device"} icon="folder-outline"><Button title={"Check storage"} secondary onPress={() => void mediaUsage().then(bytes => setStatus(`Stored music and video: ${(bytes / 1024 / 1024).toFixed(1)} MB · projects: ${data.projects.length}`)).catch(e => setStatus(displayMessage(e)))} /><Text style={ui.small}>Remove downloads or delete files from a project.</Text></SettingsItem>
    {!!status && <Text accessibilityLiveRegion="polite" style={ui.body}>{status}</Text>}
  </Page>;
}
