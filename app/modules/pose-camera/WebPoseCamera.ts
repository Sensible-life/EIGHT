// Browser stand-in for the Android pose-camera module, so the camera tab can be tried on a computer.
// Three inputs, all sending the same events as the Android module:
//   webcam (default)  the webcam in a mirrored <video>, MediaPipe Pose (lite) running in the page
//   videoUri          a dance video file played in a loop instead of the webcam, same pose model
//   demo              scripted figures (src/tracking/demoMoves.ts): no camera and no pose model at all
// Frames stay in the page. Only the MediaPipe library and the model file are downloaded.
import { createElement, useEffect, useRef, type ComponentType } from 'react';
import { View } from 'react-native';
import { DEMO_ASPECT } from '../../src/tracking/demoMoves';
import { webPoseEvent, type WebLandmark } from '../../src/tracking/webEvent';
import type { PoseCameraProps } from './index';

const VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';
const DEMO_FPS = 30;

type Landmarker = { detectForVideo: (video: HTMLVideoElement, tMs: number) => { landmarks?: WebLandmark[][]; worldLandmarks?: WebLandmark[][] }; close: () => void };
type Vision = {
  FilesetResolver: { forVisionTasks: (wasm: string) => Promise<unknown> };
  PoseLandmarker: { createFromOptions: (fileset: unknown, options: object) => Promise<Landmarker> };
};
// Metro must not try to bundle a URL import: build the import() at run time.
const importUrl = new Function('url', 'return import(url)') as (url: string) => Promise<Vision>;
const native = <T>(nativeEvent: T) => ({ nativeEvent }) as never;

function WebPoseCamera({ active, detectorJson, onPose, onEngine, onError, style, demo, videoUri }: PoseCameraProps) {
  const video = useRef<HTMLVideoElement | null>(null);
  const handlers = useRef({ onPose, onEngine, onError, demo });
  useEffect(() => { handlers.current = { onPose, onEngine, onError, demo }; }, [onPose, onEngine, onError, demo]);
  const demoOn = !!demo;

  // Demo input: a timer sends scripted figures.
  useEffect(() => {
    if (!active || !demoOn) return;
    let seq = 0;
    handlers.current.onEngine?.(native({ model: 'demo', delegate: 'script' }));
    const timer = setInterval(() => {
      const frame = handlers.current.demo?.();
      if (!frame) return;
      const tMs = performance.now();
      handlers.current.onPose?.(native(webPoseEvent({ tMs, seq: ++seq, nowMs: tMs, wallMs: Date.now(), latencyMs: 0, aspect: DEMO_ASPECT, image: frame.image, world: frame.world })));
    }, 1000 / DEMO_FPS);
    return () => clearInterval(timer);
  }, [active, demoOn]);

  // Webcam or video file: MediaPipe Pose on the <video>.
  useEffect(() => {
    if (!active || demoOn) return;
    let alive = true, raf = 0, stream: MediaStream | null = null, landmarker: Landmarker | null = null, seq = 0, lastTime = -1;
    const el = video.current;
    const fail = (message: string) => { if (alive) handlers.current.onError?.(native({ message })); };
    (async () => {
      if (!el) return;
      if (videoUri) {
        el.srcObject = null;
        el.src = videoUri;
        el.loop = true;
      } else {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
        } catch {
          return fail('카메라를 열 수 없어요. 브라우저의 카메라 권한을 확인하거나 아래 시연용 입력을 써 보세요.');
        }
        if (!alive) return stream.getTracks().forEach(t => t.stop());
        el.removeAttribute('src');
        el.srcObject = stream;
      }
      await el.play().catch(() => {});
      try {
        const cfg = JSON.parse(detectorJson) as Record<string, number>;
        const vision = await importUrl(`${VISION}/vision_bundle.mjs`);
        const fileset = await vision.FilesetResolver.forVisionTasks(`${VISION}/wasm`);
        const create = (delegate: 'GPU' | 'CPU') => vision.PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', numPoses: cfg.num_poses,
          minPoseDetectionConfidence: cfg.min_detection_confidence, minPosePresenceConfidence: cfg.min_presence_confidence, minTrackingConfidence: cfg.min_tracking_confidence,
        });
        let delegate = 'gpu';
        try { landmarker = await create('GPU'); } catch { delegate = 'cpu'; landmarker = await create('CPU'); }
        if (!alive) return landmarker.close();
        handlers.current.onEngine?.(native({ model: 'lite', delegate }));
      } catch {
        return fail('자세 인식 모델을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.');
      }
      const loop = () => {
        if (!alive) return;
        raf = requestAnimationFrame(loop);
        if (!landmarker || el.readyState < 2 || !el.videoWidth || el.currentTime === lastTime) return;
        lastTime = el.currentTime;
        const tMs = performance.now();
        try {
          const r = landmarker.detectForVideo(el, tMs), now = performance.now();
          handlers.current.onPose?.(native(webPoseEvent({
            tMs, seq: ++seq, nowMs: now, wallMs: Date.now(), latencyMs: now - tMs, aspect: el.videoWidth / el.videoHeight,
            image: r.landmarks?.[0], world: r.worldLandmarks?.[0],
          })));
        } catch {
          fail('자세 인식 중 오류가 났어요.');
        }
      };
      loop();
    })();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach(t => t.stop());
      landmarker?.close();
      if (el) { el.pause(); el.srcObject = null; el.removeAttribute('src'); }
    };
  }, [active, demoOn, detectorJson, videoUri]);

  return createElement(View, { style },
    createElement('video', { ref: video, muted: true, playsInline: true, style: { width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', display: demoOn ? 'none' : 'block' } }));
}

/** Null where there is no webcam API (an old browser, or a page not served from localhost / https). */
const WebPoseCameraView: ComponentType<PoseCameraProps> | null = typeof navigator !== 'undefined' && !!navigator.mediaDevices ? WebPoseCamera : null;
export default WebPoseCameraView;
