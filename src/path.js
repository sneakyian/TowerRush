// A polyline path enemies walk along, addressed by distance from the start.
//
// Levels describe a road with a handful of control points. Path.fromLevel()
// bends long straight runs with a gentle meander and runs a centripetal
// Catmull-Rom spline through the result, producing a dense polyline that the
// simulation walks and the renderer draws, so the road reads as a winding
// trail rather than a grid.

function dist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

// Insert an offset midpoint into every long straight segment so roads wander
// a little instead of running ruler-straight. Alternates side to side.
export function meanderWaypoints(points, { minLength = 130, amount = 0.11, maxOffset = 22 } = {}) {
  if (points.length < 2) return points.map((p) => ({ ...p }));
  const out = [{ ...points[0] }];
  let side = 1;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = dist(a, b);
    // Leave the off-screen entry and exit stubs straight.
    const offscreen = a.x < 0 || a.y < 0 || b.x < 0 || b.y < 0 || a.x > 800 || b.x > 800;
    if (len >= minLength && !offscreen) {
      const nx = -(b.y - a.y) / len;
      const ny = (b.x - a.x) / len;
      const off = Math.min(maxOffset, len * amount) * side;
      out.push({ x: (a.x + b.x) / 2 + nx * off, y: (a.y + b.y) / 2 + ny * off });
      side = -side;
    }
    out.push({ ...b });
  }
  return out;
}

// Centripetal Catmull-Rom through the control points (Barry–Goldman form).
// The first and last points are kept exactly.
export function smoothWaypoints(points, samplesPerSegment = 12) {
  if (points.length < 3) return points.map((p) => ({ ...p }));
  const pts = [points[0], ...points, points[points.length - 1]];
  const knot = (t, a, b) => t + Math.pow(Math.max(dist(a, b), 1e-6), 0.5);
  const out = [{ ...points[0] }];

  for (let i = 1; i < pts.length - 2; i++) {
    const [p0, p1, p2, p3] = [pts[i - 1], pts[i], pts[i + 1], pts[i + 2]];
    const t0 = 0;
    const t1 = knot(t0, p0, p1);
    const t2 = knot(t1, p1, p2);
    const t3 = knot(t2, p2, p3);
    for (let s = 1; s <= samplesPerSegment; s++) {
      const t = t1 + ((t2 - t1) * s) / samplesPerSegment;
      const lerp = (a, b, ta, tb) => {
        const w = (t - ta) / (tb - ta);
        return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w };
      };
      const a1 = lerp(p0, p1, t0, t1);
      const a2 = lerp(p1, p2, t1, t2);
      const a3 = lerp(p2, p3, t2, t3);
      const b1 = lerp(a1, a2, t0, t2);
      const b2 = lerp(a2, a3, t1, t3);
      out.push(lerp(b1, b2, t1, t2));
    }
  }
  return out;
}

export class Path {
  constructor(waypoints) {
    if (!waypoints || waypoints.length < 2) {
      throw new Error('Path needs at least two waypoints');
    }
    this.waypoints = waypoints;
    this.segmentLengths = [];
    this.totalLength = 0;
    for (let i = 0; i < waypoints.length - 1; i++) {
      const dx = waypoints[i + 1].x - waypoints[i].x;
      const dy = waypoints[i + 1].y - waypoints[i].y;
      const len = Math.hypot(dx, dy);
      this.segmentLengths.push(len);
      this.totalLength += len;
    }
  }

  // The smooth, winding road for a level. Set `level.smoothPath = false` to
  // walk the raw control points instead.
  static fromLevel(level) {
    if (level.smoothPath === false) return new Path(level.path);
    return new Path(smoothWaypoints(meanderWaypoints(level.path)));
  }

  // Position at `dist` from the start, clamped to the path's ends.
  positionAt(dist) {
    if (dist <= 0) return { ...this.waypoints[0] };
    let remaining = dist;
    for (let i = 0; i < this.segmentLengths.length; i++) {
      const len = this.segmentLengths[i];
      if (remaining <= len) {
        const t = len === 0 ? 0 : remaining / len;
        const a = this.waypoints[i];
        const b = this.waypoints[i + 1];
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }
      remaining -= len;
    }
    return { ...this.waypoints[this.waypoints.length - 1] };
  }
}
