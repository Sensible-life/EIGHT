// Small vector / statistics helpers matching numpy, so results equal the id403 pipeline.
import type { Vec3 } from './types';

export const EPS = 1e-6;
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const midpoint = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (a: Vec3): number => Math.sqrt(dot(a, a));
export const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** numpy.percentile(xs, q), default linear method (equal up to float rounding). */
export function percentile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const pos = ((s.length - 1) * q) / 100, lo = Math.floor(pos), hi = Math.ceil(pos), t = pos - lo;
  const d = s[hi] - s[lo];
  return t >= 0.5 ? s[hi] - d * (1 - t) : s[lo] + d * t;
}

/** Python round(x, digits): exact ties go to the even neighbour (Math.round goes up). */
export function pyRound(x: number, digits: number): number {
  const s = Math.abs(x).toFixed(digits + 30);
  if (!/^50*$/.test(s.slice(s.indexOf('.') + 1 + digits))) return Number(x.toFixed(digits));
  const m = 10 ** digits, y = Math.trunc(x * m);
  return (y % 2 === 0 ? y : y + Math.sign(x)) / m;
}
