/**
 * Where a frame point (0..1, not mirrored) lands in the on-screen box (0..1). Matches PreviewView
 * FILL_CENTER (the frame is scaled to cover the box; the overflow is cropped evenly) and the front
 * camera preview's mirror.
 */
export function projectToBox(x: number, y: number, frameAspect: number, boxAspect: number): { x: number; y: number } {
  let u = x, v = y;
  if (frameAspect > boxAspect) {
    const w = boxAspect / frameAspect; // visible share of the frame's width
    u = (x - (1 - w) / 2) / w;
  } else if (frameAspect < boxAspect) {
    const h = frameAspect / boxAspect; // visible share of the frame's height
    v = (y - (1 - h) / 2) / h;
  }
  return { x: 1 - u, y: v };
}