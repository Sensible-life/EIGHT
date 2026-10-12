import { Alert, Platform } from 'react-native';
export function confirmAction(title: string, detail: string, action: () => void) { if (Platform.OS === 'web') { if (window.confirm(`${title}\n${detail}`)) action(); } else Alert.alert(title, detail, [{ text: '취소', style: 'cancel' }, { text: '확인', style: 'destructive', onPress: action }]); }
