/** A small planar graph of quadratic Bézier edges. The paper's frame is never a boundary. */
export type Point = { x: number; y: number };
export type Edge = { id: string; a: Point; b: Point; c: Point };
export type DirectedEdge = { edge: Edge; forward: boolean };
export type Face = {
  key: string;
  boundary: DirectedEdge[];
  polygon: Point[];
  holes: Point[][];
  holePaths: string[];
  edgeIds: Set<string>;
  area: number;
  rawArea: number;
  center: Point;
};

export const GRID = Array.from({ length: 49 }, (_, i) => ({ x: 36 + (i % 7) * 48, y: 36 + Math.floor(i / 7) * 48 }));
export const pointKey = (p: Point) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`;
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const samePoint = (a: Point, b: Point) => distance(a, b) < 0.01;
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export function makeEdge(a: Point, b: Point, bend: number, id: string = crypto.randomUUID()): Edge {
  return { id, a, b, c: { x: (a.x + b.x) / 2 - (b.y - a.y) * bend * 0.2, y: (a.y + b.y) / 2 + (b.x - a.x) * bend * 0.2 } };
}

export function at(edge: Edge, t: number): Point {
  return lerp(lerp(edge.a, edge.c, t), lerp(edge.c, edge.b, t), t);
}

export function sample(edge: Edge, count = 40): Point[] {
  return Array.from({ length: count + 1 }, (_, i) => at(edge, i / count));
}

export function curveValue(edge: Edge): number {
  const dx = edge.b.x - edge.a.x, dy = edge.b.y - edge.a.y;
  return Math.round(((edge.c.y - (edge.a.y + edge.b.y) / 2) * dx - (edge.c.x - (edge.a.x + edge.b.x) / 2) * dy) / (dx * dx + dy * dy) / 0.2);
}

export function nearestOnEdge(edge: Edge, p: Point): { point: Point; t: number; distance: number } {
  let bestT = 0, bestD = Infinity;
  for (let i = 0; i <= 40; i++) {
    const d = distance(at(edge, i / 40), p);
    if (d < bestD) { bestD = d; bestT = i / 40; }
  }
  let lo = Math.max(0, bestT - 0.025), hi = Math.min(1, bestT + 0.025);
  for (let i = 0; i < 24; i++) {
    const l = lo + (hi - lo) / 3, r = hi - (hi - lo) / 3;
    if (distance(at(edge, l), p) < distance(at(edge, r), p)) hi = r; else lo = l;
  }
  const t = (lo + hi) / 2, point = at(edge, t);
  return { point, t, distance: distance(point, p) };
}

export function snapPoint(p: Point, edges: Edge[]): Point | null {
  const endpoints = [...new Map(edges.flatMap(e => [e.a, e.b]).map(q => [pointKey(q), q])).values()];
  const endpoint = endpoints.sort((a, b) => distance(a, p) - distance(b, p))[0];
  if (endpoint && distance(endpoint, p) <= 19) return endpoint;
  const grid = [...GRID].sort((a, b) => distance(a, p) - distance(b, p))[0];
  if (distance(grid, p) <= 22) {
    // A grid point on a line becomes a real junction, including on a curved line.
    const near = edges.map(e => nearestOnEdge(e, grid)).find(r => r.distance < 0.25);
    return near ? near.point : grid;
  }
  const near = edges.map(e => nearestOnEdge(e, p)).sort((a, b) => a.distance - b.distance)[0];
  return near && near.distance <= 13 ? near.point : null;
}

function split(edge: Edge, t: number, junction: Point): [Edge, Edge] {
  return [
    { id: `${edge.id}:a`, a: edge.a, c: lerp(edge.a, edge.c, t), b: junction },
    { id: `${edge.id}:b`, a: junction, c: lerp(edge.c, edge.b, t), b: edge.b },
  ];
}

const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
function segmentIntersection(a: Point, b: Point, c: Point, d: Point): Point | 'overlap' | null {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-8) {
    if (Math.abs(cross(a, b, c)) > 1e-6) return null;
    const len = rx * rx + ry * ry;
    if (len < 1e-10) return null;
    const t1 = ((c.x - a.x) * rx + (c.y - a.y) * ry) / len;
    const t2 = ((d.x - a.x) * rx + (d.y - a.y) * ry) / len;
    const low = Math.max(0, Math.min(t1, t2)), high = Math.min(1, Math.max(t1, t2));
    if (high - low > 1e-5) return 'overlap';
    return high >= low - 1e-7 ? lerp(a, b, Math.max(0, low)) : null;
  }
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
  return t >= -1e-7 && t <= 1 + 1e-7 && u >= -1e-7 && u <= 1 + 1e-7 ? lerp(a, b, t) : null;
}

export function validateEdges(edges: Edge[]): string | null {
  for (const edge of edges) {
    if (distance(edge.a, edge.b) < 10) return 'もう少し離れた点を選んでください。';
    if (sample(edge).some(p => p.x < 20 || p.x > 340 || p.y < 20 || p.y > 340)) return '紙の外にはみ出します。ふくらみを小さくしてみましょう。';
  }
  const samples = edges.map(e => sample(e));
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const shared = [edges[i].a, edges[i].b].filter(p => samePoint(p, edges[j].a) || samePoint(p, edges[j].b));
      for (let a = 0; a < samples[i].length - 1; a++) {
        for (let b = 0; b < samples[j].length - 1; b++) {
          const hit = segmentIntersection(samples[i][a], samples[i][a + 1], samples[j][b], samples[j][b + 1]);
          if (hit === 'overlap') return '同じ場所に線があります。別の点やふくらみを選んでください。';
          if (hit && !shared.some(p => distance(p, hit) < 0.05)) return '線が途中で交わります。線の上の点で区切ってつなぎましょう。';
        }
      }
    }
  }
  return null;
}

/** Split at explicit junctions, never silently turn a crossing into a connection. */
export function addEdge(edges: Edge[], edge: Edge): { edges: Edge[]; error: string | null } {
  let existing = [...edges];
  for (const p of [edge.a, edge.b]) {
    existing = existing.flatMap(e => {
      if (samePoint(e.a, p) || samePoint(e.b, p)) return [e];
      const near = nearestOnEdge(e, p);
      return near.distance < 0.03 && near.t > 0.001 && near.t < 0.999 ? split(e, near.t, p) : [e];
    });
  }
  let pieces = [edge];
  const endpoints = new Map(existing.flatMap(e => [e.a, e.b]).map(p => [pointKey(p), p]));
  for (const p of endpoints.values()) {
    pieces = pieces.flatMap(e => {
      if (samePoint(e.a, p) || samePoint(e.b, p)) return [e];
      const near = nearestOnEdge(e, p);
      return near.distance < 0.03 && near.t > 0.001 && near.t < 0.999 ? split(e, near.t, p) : [e];
    });
  }
  const result = [...existing, ...pieces];
  return { edges: result, error: validateEdges(result) };
}

function signedArea(poly: Point[]): number {
  return poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + p.x * q.y - q.x * p.y; }, 0) / 2;
}

export function inPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export const inFace = (p: Point, f: Face) => inPolygon(p, f.polygon) && !f.holes.some(h => inPolygon(p, h));

function interiorPoint(poly: Point[], holes: Point[][] = []): Point {
  const a = signedArea(poly);
  let x = 0, y = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], k = p.x * q.y - q.x * p.y;
    x += (p.x + q.x) * k; y += (p.y + q.y) * k;
  }
  const center = { x: x / (6 * a), y: y / (6 * a) };
  const inside = (p: Point) => inPolygon(p, poly) && !holes.some(h => inPolygon(p, h));
  if (inside(center)) return center;
  for (let step = 12; step >= 1; step /= 2) {
    for (let yy = 21; yy <= 339; yy += step) {
      for (let xx = 21; xx <= 339; xx += step) {
        if (inside({ x: xx, y: yy })) return { x: xx, y: yy };
      }
    }
  }
  return poly[0];
}

const n = (v: number) => Number(v.toFixed(3));
export const edgePath = (e: Edge) => `M${n(e.a.x)} ${n(e.a.y)}Q${n(e.c.x)} ${n(e.c.y)} ${n(e.b.x)} ${n(e.b.y)}`;
function boundaryPath(boundary: DirectedEdge[]): string {
  const first = boundary[0];
  const start = first.forward ? first.edge.a : first.edge.b;
  return `M${n(start.x)} ${n(start.y)}` + boundary.map(({ edge: e, forward }) => {
    const end = forward ? e.b : e.a;
    return `Q${n(e.c.x)} ${n(e.c.y)} ${n(end.x)} ${n(end.y)}`;
  }).join('') + 'Z';
}
export const facePath = (f: Face) => [boundaryPath(f.boundary), ...f.holePaths].join('');

export function getFaces(edges: Edge[]): Face[] {
  const outgoing = new Map<string, DirectedEdge[]>();
  for (const edge of edges) {
    for (const forward of [true, false]) {
      const key = pointKey(forward ? edge.a : edge.b);
      outgoing.set(key, [...(outgoing.get(key) ?? []), { edge, forward }]);
    }
  }
  for (const list of outgoing.values()) {
    list.sort((a, b) => {
      const angle = ({ edge: e, forward }: DirectedEdge) => {
        const from = forward ? e.a : e.b;
        return Math.atan2(e.c.y - from.y, e.c.x - from.x);
      };
      return angle(a) - angle(b);
    });
  }
  const directedKey = (d: DirectedEdge) => `${d.edge.id}/${d.forward ? '+' : '-'}`;
  const visited = new Set<string>(), faces: Face[] = [];
  for (const list of outgoing.values()) {
    for (const first of list) {
      if (visited.has(directedKey(first))) continue;
      const boundary: DirectedEdge[] = [], polygon: Point[] = [];
      let current = first;
      for (let safety = 0; safety <= edges.length * 2; safety++) {
        const key = directedKey(current);
        if (visited.has(key)) break;
        visited.add(key);
        boundary.push(current);
        const points = sample(current.edge);
        polygon.push(...(current.forward ? points : points.reverse()).slice(0, -1));
        const end = current.forward ? current.edge.b : current.edge.a;
        const next = outgoing.get(pointKey(end))!;
        const reverseIndex = next.findIndex(d => d.edge.id === current.edge.id && d.forward !== current.forward);
        current = next[(reverseIndex + next.length - 1) % next.length];
      }
      const area = signedArea(polygon);
      if (area > 24) {
        faces.push({ key: [...boundary.map(d => d.edge.id)].sort().join('|'), boundary, polygon, holes: [], holePaths: [], edgeIds: new Set(boundary.map(d => d.edge.id)), area, rawArea: area, center: interiorPoint(polygon) });
      }
    }
  }
  // Disconnected closed loops can nest. Their enclosing face has an actual hole.
  for (const child of faces) {
    const parent = faces.filter(f => f.rawArea > child.rawArea + 0.01 && inPolygon(child.center, f.polygon) && ![...child.edgeIds].some(id => f.edgeIds.has(id))).sort((a, b) => a.rawArea - b.rawArea)[0];
    if (parent) {
      parent.holes.push(child.polygon);
      parent.holePaths.push(boundaryPath(child.boundary));
      parent.area -= child.rawArea;
      for (const id of child.edgeIds) parent.edgeIds.add(id);
    }
  }
  for (const f of faces) {
    f.key = [...f.edgeIds].sort().join('|');
    f.center = interiorPoint(f.polygon, f.holes);
  }
  return faces.sort((a, b) => b.rawArea - a.rawArea);
}

export const adjacent = (a: Face, b: Face) => [...a.edgeIds].some(id => b.edgeIds.has(id));

export type Ink = 'vermilion' | 'indigo' | 'ochre';
export type Paints = Record<string, Ink>;
export function inheritPaints(before: Face[], after: Face[], paints: Paints): Paints {
  const inherited: Paints = {};
  for (const face of after) {
    if (paints[face.key]) { inherited[face.key] = paints[face.key]; continue; }
    const source = before.find(f => inFace(face.center, f));
    if (source && paints[source.key]) inherited[face.key] = paints[source.key];
  }
  return inherited;
}

/** An 18px-wide corridor through the inner band; tiny invisible gaps cannot pass. */
export function whiteCorridor(faces: Face[], paints: Paints, edges: Edge[]): Point[] | null {
  const step = 6, xs = 55, ys = 33, points = edges.flatMap(e => sample(e, 70));
  const colored = faces.filter(f => paints[f.key]);
  const queue: number[] = [], cameFrom = new Map<number, number>();
  const point = (index: number): Point => ({ x: 18 + (index % xs) * step, y: 84 + Math.floor(index / xs) * step });
  const clear = (index: number) => {
    const p = point(index);
    return !colored.some(f => inFace(p, f)) && !points.some(q => distance(p, q) < 11);
  };
  const safe = Array.from({ length: xs * ys }, (_, i) => clear(i));
  for (let y = 0; y < ys; y++) {
    const i = y * xs;
    if (safe[i]) { queue.push(i); cameFrom.set(i, -1); }
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head], x = i % xs, y = Math.floor(i / xs);
    if (x === xs - 1) {
      const path: Point[] = [];
      for (let at = i; at !== -1; at = cameFrom.get(at)!) path.push(point(at));
      return path.reverse();
    }
    const neighbors = [x > 0 ? i - 1 : -1, x < xs - 1 ? i + 1 : -1, y > 0 ? i - xs : -1, y < ys - 1 ? i + xs : -1];
    for (const n of neighbors) if (n >= 0 && safe[n] && !cameFrom.has(n)) { cameFrom.set(n, i); queue.push(n); }
  }
  return null;
}
