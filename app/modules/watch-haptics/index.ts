import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
export interface WatchHapticsNative {
  now(): number;
  connect(): Promise<{ name: string; roundTripMs: number }>;
  prepare(pattern: string): Promise<void>;
  sync(state: string): Promise<void>;
  stop(): Promise<void>;
  test(): Promise<void>;
}
export default Platform.OS === 'android' ? requireOptionalNativeModule<WatchHapticsNative>('WatchHaptics') : null;
