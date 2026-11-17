import { requireNativeView } from 'expo';
import type { ComponentType, RefAttributes } from 'react';
import { Platform, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import type { DemoFrame } from '../../src/tracking/demoMoves';
import type { PoseEvent } from '../../src/tracking/types';
import WebPoseCameraView from './WebPoseCamera';

export type PoseCameraProps = ViewProps & {
  active: boolean;
  model: 'lite';
  detectorJson: string;
  onPose?: (e: NativeSyntheticEvent<PoseEvent>) => void;
  onEngine?: (e: NativeSyntheticEvent<{ model: string; delegate: string }>) => void;
  onRecording?: (e: NativeSyntheticEvent<{ state: 'started' | 'saved' | 'error'; value: string }>) => void;
  onError?: (e: NativeSyntheticEvent<{ message: string }>) => void;
  // Browser only (WebPoseCamera.ts), for trying the app without a phone. Never pass these on Android.
  demo?: () => DemoFrame | null; // scripted figures instead of the camera
  videoUri?: string; // a dance video file instead of the webcam
};

/** Front camera preview + pose events. Android: the native module (it also records video). Web: the webcam stand-in (WebPoseCamera.ts), no video recording. Null on iOS. */
export type PoseCameraHandle = { startRecording(): Promise<void>; stopRecording(): Promise<void> };
const PoseCameraView: ComponentType<PoseCameraProps & RefAttributes<PoseCameraHandle>> | null =
  Platform.OS === 'android' ? requireNativeView<PoseCameraProps & RefAttributes<PoseCameraHandle>>('PoseCamera') : Platform.OS === 'web' ? WebPoseCameraView : null;
export default PoseCameraView;