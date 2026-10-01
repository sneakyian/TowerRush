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
