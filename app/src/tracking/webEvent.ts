// The browser camera's MediaPipe result -> the PoseEvent the Android pose-camera module sends.
import { NUM_LANDMARKS, type PoseEvent } from './types';

export type WebLandmark = { x: number; y: number; z: number; visibility?: number };
export type WebFrame = {
  tMs: number; // performance.now() when the frame was taken
  seq: number;
  nowMs: number; // performance.now() when the event is sent
  wallMs: number; // Date.now() when the event is sent
  latencyMs: number; // frame -> pose result
  aspect: number; // video width / height
  image?: WebLandmark[];
  world?: WebLandmark[];
};

export function webPoseEvent(f: WebFrame): PoseEvent {
  const seen = f.image?.length === NUM_LANDMARKS && f.world?.length === NUM_LANDMARKS;
  return {
    tMs: f.tMs, seq: f.seq, ageMs: f.nowMs - f.tMs, emitWallMs: f.wallMs, latencyMs: f.latencyMs, captureFrom: 'analyzer', aspect: f.aspect,
    image: seen ? f.image!.flatMap(p => [p.x, p.y, p.visibility ?? 1]) : [],
    world: seen ? f.world!.flatMap(p => [p.x, p.y, p.z]) : [],
  };
}
