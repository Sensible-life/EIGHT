import { requireNativeView } from 'expo';
import type { ComponentType } from 'react';
import { Platform, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import type { PoseEvent } from '../../src/tracking/types';

export type PoseCameraProps = ViewProps & {
  active: boolean;
  model: 'lite';
  detectorJson: string;
  onPose?: (e: NativeSyntheticEvent<PoseEvent>) => void;
  onEngine?: (e: NativeSyntheticEvent<{ model: string; delegate: string }>) => void;
  onError?: (e: NativeSyntheticEvent<{ message: string }>) => void;
};

/** Front camera preview + pose events. Android only; null elsewhere (the web preview shows a note). */
const PoseCameraView: ComponentType<PoseCameraProps> | null =
  Platform.OS === 'android' ? requireNativeView<PoseCameraProps>('PoseCamera') : null;
export default PoseCameraView;