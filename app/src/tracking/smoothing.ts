// One Euro filter (Casiez et al., CHI 2012), element-wise over a flat array (id403 smoothing.py).
// Jitter on a still body would otherwise count as "using" that part, so this is core logic.
import type { Landmarks, Vec3 } from './types';

const alpha = (cutoff: number, dt: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff) / dt);

export class OneEuroFilter {
  private xPrev: number[] | null = null;
  private dxPrev: number[] | null = null;
  private tPrev: number | null = null;

  constructor(readonly minCutoff = 1.0, readonly beta = 0.05, readonly dCutoff = 1.0) {}

  reset(): void {
    this.xPrev = this.dxPrev = this.tPrev = null;
  }

  filter(x: number[], tS: number): number[] {
    if (this.xPrev === null || this.dxPrev === null || this.tPrev === null) {
      this.xPrev = [...x];
      this.dxPrev = x.map(() => 0);
      this.tPrev = tS;
      return [...x];
    }
    const dt = Math.max(tS - this.tPrev, 1e-6), aD = alpha(this.dCutoff, dt);
    const out = new Array<number>(x.length), dxHat = new Array<number>(x.length);
    for (let i = 0; i < x.length; i++) {
      const dx = (x[i] - this.xPrev[i]) / dt;
      dxHat[i] = aD * dx + (1 - aD) * this.dxPrev[i];
      const tau = 1 / (2 * Math.PI * (this.minCutoff + this.beta * Math.abs(dxHat[i])));
      const a = 1 / (1 + tau / dt);
      out[i] = a * x[i] + (1 - a) * this.xPrev[i];
    }
    this.xPrev = out;
    this.dxPrev = dxHat;
    this.tPrev = tS;
    return [...out];
  }
}

export const flatten = (lm: Landmarks): number[] => lm.flatMap(p => [p[0], p[1], p[2]]);
export const unflatten = (xs: number[]): Landmarks =>
  Array.from({ length: xs.length / 3 }, (_, i) => [xs[3 * i], xs[3 * i + 1], xs[3 * i + 2]] as Vec3);
