import type { PoseMessage } from '../tracking/types';
export type Point = { x: number; y: number };

/** Map four camera-image corners to the unit square using a projective transform. */
export function floorTransform(corners: Point[]): ((point: Point) => Point | null) | null {
  if (corners.length !== 4 || corners.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const turns = corners.map((p, i) => {
    const q = corners[(i + 1) % 4], r = corners[(i + 2) % 4];
    return (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x);
  });
  if (turns.some(v => Math.abs(v) < 1e-5) || turns.some(v => Math.sign(v) !== Math.sign(turns[0]))) return null;
  const targets = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const matrix: number[][] = [];
  corners.forEach(({ x, y }, i) => {
    const [u, v] = targets[i];
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  });
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(matrix[r][col]) > Math.abs(matrix[pivot][col])) pivot = r;
    if (Math.abs(matrix[pivot][col]) < 1e-8) return null;
    [matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]];
    const divisor = matrix[col][col];
    for (let j = col; j <= 8; j++) matrix[col][j] /= divisor;
    for (let r = 0; r < 8; r++) if (r !== col) {
      const factor = matrix[r][col];
      for (let j = col; j <= 8; j++) matrix[r][j] -= factor * matrix[col][j];
    }
  }
  const h = matrix.map(row => row[8]);
  return ({ x, y }) => {
    const d = h[6] * x + h[7] * y + 1;
    if (Math.abs(d) < 1e-8) return null;
    const u = (h[0] * x + h[1] * y + h[2]) / d, v = (h[3] * x + h[4] * y + h[5]) / d;
    return Number.isFinite(u) && Number.isFinite(v) ? { x: u, y: v } : null;
  };
}

/** Time spent by visible feet. Uncalibrated values are camera-image positions. */
export class ImageHeatmap {
  private cells = Array<number>(64).fill(0);
  private previous: number | null = null;
  constructor(private readonly transform: ((point: Point) => Point | null) | null = null) {}
  update(pose: PoseMessage | null, active: boolean, now: number): number[] {
    const dt = this.previous === null ? 0 : Math.max(0, Math.min(250, now - this.previous));
    this.previous = now;
    if (active && pose && now - pose.t < 500) {
      for (const i of [27, 28]) {
        const p = pose.lm[i];
        if (!p || p[2] < 0.6 || p[0] < 0 || p[0] > 1 || p[1] < 0 || p[1] > 1) continue;
        const point = this.transform ? this.transform({ x: 1 - p[0], y: p[1] }) : { x: 1 - p[0], y: p[1] };
        if (!point || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) continue;
        const x = Math.min(7, Math.floor(point.x * 8)), y = Math.min(7, Math.floor(point.y * 8));
        this.cells[y * 8 + x] += dt / 2;
      }
    }
    const max = Math.max(...this.cells, 1);
    return this.cells.map(v => Math.round(v / max * 1000) / 1000);
  }
}
