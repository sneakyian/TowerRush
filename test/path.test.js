import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Path } from '../src/path.js';

test('path requires at least two waypoints', () => {
  assert.throws(() => new Path([]));
  assert.throws(() => new Path([{ x: 0, y: 0 }]));
});

test('total length sums all segments', () => {
  const path = new Path([
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 50 },
  ]);
  assert.equal(path.totalLength, 150);
});

test('positionAt interpolates along segments', () => {
  const path = new Path([
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ]);
  assert.deepEqual(path.positionAt(50), { x: 50, y: 0 });
  assert.deepEqual(path.positionAt(100), { x: 100, y: 0 });
  assert.deepEqual(path.positionAt(150), { x: 100, y: 50 });
});

test('positionAt clamps to path ends', () => {
  const path = new Path([
    { x: 10, y: 20 },
    { x: 110, y: 20 },
  ]);
  assert.deepEqual(path.positionAt(-5), { x: 10, y: 20 });
  assert.deepEqual(path.positionAt(9999), { x: 110, y: 20 });
});

// --- Smoothing -----------------------------------------------------------------

import { smoothWaypoints, meanderWaypoints } from '../src/path.js';

// Largest turn (radians) between consecutive segments of a polyline.
function sharpestTurn(points) {
  let worst = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const a1 = Math.atan2(points[i].y - points[i - 1].y, points[i].x - points[i - 1].x);
    const a2 = Math.atan2(points[i + 1].y - points[i].y, points[i + 1].x - points[i].x);
    let d = Math.abs(a2 - a1);
    if (d > Math.PI) d = Math.PI * 2 - d;
    worst = Math.max(worst, d);
  }
  return worst;
}

test('smoothing keeps the endpoints exactly and densifies the polyline', () => {
  const corners = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 100 }];
  const smooth = smoothWaypoints(corners);
  assert.deepEqual(smooth[0], corners[0]);
  const last = smooth[smooth.length - 1];
  assert.ok(Math.abs(last.x - 200) < 1e-6 && Math.abs(last.y - 100) < 1e-6);
  assert.ok(smooth.length > corners.length * 5);
});

test('smoothing turns right angles into gentle curves', () => {
  const corners = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 100 }];
  assert.ok(sharpestTurn(corners) > Math.PI / 2 - 1e-6, 'control polyline has right angles');
  assert.ok(sharpestTurn(smoothWaypoints(corners)) < Math.PI / 6, 'smoothed path has no sharp turns');
});

test('smoothing a straight line stays on the line', () => {
  const line = [{ x: 0, y: 50 }, { x: 100, y: 50 }, { x: 200, y: 50 }];
  for (const p of smoothWaypoints(line)) assert.ok(Math.abs(p.y - 50) < 1e-6);
});

test('meander bends long on-screen segments but leaves short and off-screen ones alone', () => {
  const pts = [{ x: -20, y: 100 }, { x: 100, y: 100 }, { x: 400, y: 100 }, { x: 450, y: 100 }];
  const out = meanderWaypoints(pts);
  // Only the 300px middle segment gains a midpoint.
  assert.equal(out.length, pts.length + 1);
  const mid = out[2];
  assert.ok(Math.abs(mid.x - 250) < 1e-6);
  assert.ok(Math.abs(mid.y - 100) > 10, 'midpoint is pushed off the straight line');
});

test('Path.fromLevel walks a smooth road unless the level opts out', () => {
  const level = { path: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }] };
  assert.ok(Path.fromLevel(level).waypoints.length > 3);
  assert.equal(Path.fromLevel({ ...level, smoothPath: false }).waypoints.length, 3);
});
