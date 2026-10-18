// Downloads the MediaPipe pose model into the pose-camera module's assets (git-ignored, public repo).
const fs = require('node:fs');
const path = require('node:path');
const URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';
const dest = path.join(__dirname, '..', 'modules', 'pose-camera', 'android', 'src', 'main', 'assets', 'models', 'pose_landmarker_lite.task');

(async () => {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return console.log(`[skip] ${path.relative(process.cwd(), dest)}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`${URL}: HTTP ${res.status}`);
  const tmp = `${dest}.part`;
  fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(tmp, dest);
  console.log(`[ok] ${path.relative(process.cwd(), dest)} (${fs.statSync(dest).size} bytes)`);
})().catch(e => { console.error(e.message); process.exit(1); });