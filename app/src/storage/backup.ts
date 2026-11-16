import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { Library } from '../state/model';
export async function exportBackup(data: Library) {
  const text = JSON.stringify(data, null, 2), name = `choreolayer-${new Date().toISOString().slice(0, 10)}.json`;
  if (Platform.OS === 'web') { const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
  else { const file = new File(Paths.cache, name); if (!file.exists) file.create(); file.write(text); if (!await Sharing.isAvailableAsync()) throw new Error("File sharing is unavailable on this device."); await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: "Session history backup" }); }
}
