const assert = require('./assert.cjs');
const { projectToBox } = require('../load-ts.cjs')('src/tracking/overlay.ts');
const { close } = require('./helpers.cjs');

assert.deepEqual(projectToBox(0.25, 0.4, 0.75, 0.75), { x: 0.75, y: 0.4 }, 'same aspect: mirror only');
{
  // frame wider than the box: the sides are cropped and the middle fills the box
  const mid = projectToBox(0.5, 0.5, 1.0, 0.75);
  close(mid.x, 0.5);
  close(mid.y, 0.5);
  const edge = projectToBox(0.125, 0.3, 1.0, 0.75);
  close(edge.x, 1, 1e-9, 'left crop edge lands on the mirrored right edge');
  close(edge.y, 0.3);
}
{
  // frame taller than the box: top and bottom are cropped
  const p = projectToBox(0.5, 0.2, 0.5, 0.75);
  close(p.x, 0.5);
  close(p.y, 0.05);
}
