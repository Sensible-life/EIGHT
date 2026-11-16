import { Alert, Platform } from 'react-native';
export function confirmAction(title: string, detail: string, action: () => void) { if (Platform.OS === 'web') { if (window.confirm(`${title}\n${detail}`)) action(); } else Alert.alert(title, detail, [{ text: "Cancel", style: 'cancel' }, { text: "Confirm", style: 'destructive', onPress: action }]); }
