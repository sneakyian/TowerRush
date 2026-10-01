// A polyline path enemies walk along, addressed by distance from the start.

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
