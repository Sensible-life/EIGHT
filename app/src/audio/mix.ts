export type LayerMix = { volume: number; muted: boolean; solo: boolean };
export type Mix = Record<string, LayerMix>;

export const initialMix = (stems: string[]): Mix => Object.fromEntries(
  stems.map(stem => [stem, { volume: 1, muted: false, solo: false }]),
);

export function layerGain(mix: Mix, stem: string): number {
  const layer = mix[stem];
  const anySolo = Object.values(mix).some(item => item.solo);
  if (!layer || layer.muted || (anySolo && !layer.solo)) return 0;
  return layer.volume;
}
