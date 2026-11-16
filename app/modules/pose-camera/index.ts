import { requireNativeView } from 'expo';
import type { ComponentType, RefAttributes } from 'react';
import { Platform, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import type { PoseEvent } from '../../src/tracking/types';

export type PoseCameraProps = ViewProps & {
  active: boolean;
  model: 'lite';
  detectorJson: string;
  onPose?: (e: NativeSyntheticEvent<PoseEvent>) => void;
  onEngine?: (e: NativeSyntheticEvent<{ model: string; delegate: string }>) => void;
  onRecording?: (e: NativeSyntheticEvent<{ state: 'started' | 'saved' | 'error'; value: string }>) => void;
  onError?: (e: NativeSyntheticEvent<{ message: string }>) => void;
};

/** Front camera preview + pose events. Android only; null elsewhere (the web preview shows a note). */
export type PoseCameraHandle = { startRecording(): Promise<void>; stopRecording(): Promise<void> };
const PoseCameraView: ComponentType<PoseCameraProps & RefAttributes<PoseCameraHandle>> | null =
  Platform.OS === 'android' ? requireNativeView<PoseCameraProps & RefAttributes<PoseCameraHandle>>('PoseCamera') : null;
export default PoseCameraView;