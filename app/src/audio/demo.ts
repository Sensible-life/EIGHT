import { Asset } from 'expo-asset';
import { Job } from '../api';
export async function demoJob(): Promise<Job> {
  const assets = [Asset.fromModule(require('../../assets/audio/demo-bass.wav')), Asset.fromModule(require('../../assets/audio/demo-drums.wav'))];
  await Promise.all(assets.map(asset => asset.downloadAsync()));
  return { id: 'demo-groove', name: '첫 번째 그루브 · 체험 음악', status: 'done', stage: '완료', progress: 1, tempo: 120, stems: ['bass', 'drums'], files: { bass: assets[0].localUri ?? assets[0].uri, drums: assets[1].localUri ?? assets[1].uri }, config: { model: 'demo', shifts: 1, overlap: 0 }, createdAt: 0 };
}
