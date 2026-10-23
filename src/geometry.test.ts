import { describe, expect, it } from 'vitest';
import { addEdge, adjacent, getFaces, inFace, makeEdge, nearestOnEdge, sample, validateEdges, whiteCorridor, type Edge, type Point } from './geometry';
import { bendLine, drawLine, evaluate, getStudy, newSession, paintFace, parseStore, redo, snapshot, undo, type Session } from './model';

const p = (x: number, y: number): Point => ({ x, y });
function draw(s: Session, a: Point, b: Point, bend = 0): Session {
  const change = drawLine(s, a, b, bend);
  expect(change.error).toBeNull();
  return change.session;
}
function paintAt(s: Session, point: Point, ink: 'vermilion' | 'indigo' | 'ochre'): Session {
  const face = getFaces(s.edges).find(f => inFace(point, f));
  expect(face).toBeDefined();
  const change = paintFace(s, face!.key, ink);
  expect(change.error).toBeNull();
  return change.session;
}
function firstStudy(): Session {
  let s = newSession('01');
  const a = p(180, 84), b = p(180, 276), left = p(84, 180), right = p(276, 180);
  s = draw(draw(s, a, left), left, b);
  s = paintAt(s, p(126, 180), 'vermilion');
  s = draw(draw(s, a, right), right, b);
  return paintAt(s, p(228, 180), 'indigo');
}
const square = (lo: number, hi: number, prefix: string) => [p(lo, lo), p(hi, lo), p(hi, hi), p(lo, hi)].map((a, i, points) => makeEdge(a, points[(i + 1) % 4], 0, `${prefix}-${i}`));

describe('closed regions and shared curved boundaries', () => {
  it('starts with no filled region; the paper frame and open lines are not faces', () => {
    expect(getFaces([])).toEqual([]);
    expect(getFaces(getStudy('01').seeds)).toEqual([]);
  });

  it('recognizes adjacent faces, keeps paint local, and allows visibly different solutions', () => {
    const s = firstStudy(), faces = getFaces(s.edges);
    expect(faces).toHaveLength(2);
    expect(adjacent(faces[0], faces[1])).toBe(true);
    expect(s.moves).toBe(6);
    expect(evaluate(s).done).toBe(true);
    const bent = bendLine(s, 'seed-01', -1);
    expect(bent.error).toBeNull();
    expect(evaluate(bent.session).done).toBe(true);
    expect(bent.session.paints).toEqual(s.paints);
    expect(getFaces(bent.session.edges).find(f => f.key === faces[0].key)!.area).not.toBeCloseTo(faces[0].area, 0);
    expect(evaluate(bendLine(s, 'seed-01', 2).session).done).toBe(false);
  });

  it('supports two arcs between the same endpoints, making a lens', () => {
    const a = p(84, 180), b = p(276, 180);
    const edges = [makeEdge(a, b, 2, 'a'), makeEdge(a, b, -2, 'b')];
    expect(validateEdges(edges)).toBeNull();
    expect(getFaces(edges)).toHaveLength(1);
    expect(getFaces(edges)[0].area).toBeGreaterThan(9000);
  });

  it('rejects overlap, crossings without a junction, and curves outside the paper', () => {
    const edge = makeEdge(p(84, 84), p(276, 276), 0, 'one');
    expect(addEdge([edge], makeEdge(edge.a, edge.b, 0, 'duplicate')).error).toContain('同じ場所');
    expect(addEdge([edge], makeEdge(p(84, 276), p(276, 84), 0, 'cross')).error).toContain('交わり');
    expect(validateEdges([makeEdge(p(36, 36), p(324, 36), -2, 'outside')])).toContain('はみ出');
  });

  it('splits a curved edge at a chosen point without changing its shape', () => {
    const edge = makeEdge(p(84, 84), p(84, 276), 2, 'arc');
    const junction = nearestOnEdge(edge, p(40, 180)).point;
    const result = addEdge([edge], makeEdge(junction, p(180, 180), 0, 'new'));
    expect(result.error).toBeNull();
    expect(result.edges).toHaveLength(3);
    for (const piece of result.edges.filter(e => e.id.startsWith('arc'))) {
      for (const q of sample(piece, 10)) expect(nearestOnEdge(edge, q).distance).toBeLessThan(0.001);
    }
  });

  it('handles nested loops as holes, including three nesting levels', () => {
    const faces = getFaces([...square(36, 324, 'outer'), ...square(84, 276, 'middle'), ...square(132, 228, 'inner')]);
    expect(faces).toHaveLength(3);
    expect(faces.reduce((sum, f) => sum + f.area, 0)).toBeCloseTo(288 * 288, 5);
    expect(faces.filter(f => inFace(p(180, 180), f))).toHaveLength(1);
    expect(faces.filter(f => inFace(p(60, 180), f))).toHaveLength(1);
  });
});

describe('challenges, limits, and reversible composition', () => {
  it('fully refunds a committed move and ink on undo, with exact redo', () => {
    const s = firstStudy(), previous = undo(s), restored = redo(previous);
    expect(previous.moves).toBe(5);
    expect(Object.keys(previous.paints)).toHaveLength(1);
    expect(snapshot(restored)).toEqual(snapshot(s));
    expect(restored.future).toHaveLength(0);
    expect(evaluate(restored).done).toBe(true);
  });

  it('drops the redo branch after a new decision', () => {
    const s = undo(firstStudy());
    const next = paintAt(s, p(228, 180), 'ochre');
    expect(next.future).toEqual([]);
    expect(redo(next)).toBe(next);
  });

  it('enforces the 12-move budget, without charging for reselecting the same color', () => {
    const s = { ...firstStudy(), moves: 12 };
    expect(drawLine(s, p(36, 36), p(84, 36), 0).error).toContain('12手');
    const face = getFaces(s.edges).find(f => s.paints[f.key] === 'vermilion')!;
    expect(paintFace(s, face.key, 'vermilion').session.moves).toBe(12);
    expect(evaluate(s).done).toBe(true);
  });

  it('preserves a parent face color when a new boundary divides it', () => {
    let s = newSession('free');
    for (const e of square(84, 276, 'square')) s = draw(s, e.a, e.b);
    s = paintAt(s, p(132, 180), 'vermilion');
    s = draw(s, p(180, 84), p(180, 276));
    expect(getFaces(s.edges)).toHaveLength(2);
    expect(Object.values(s.paints)).toEqual(['vermilion', 'vermilion']);
  });

  it('can solve the whitespace study and rejects a narrow corridor', () => {
    let s = newSession('02');
    s = draw(draw(s, p(228, 84), p(180, 36)), p(180, 36), p(84, 84));
    s = paintAt(s, p(168, 70), 'vermilion');
    s = draw(draw(s, p(276, 276), p(228, 324)), p(228, 324), p(132, 276));
    s = paintAt(s, p(210, 290), 'indigo');
    expect(evaluate(s).done).toBe(true);
    const barrier: Edge[] = [makeEdge(p(180, 36), p(180, 180), 0, 'top'), makeEdge(p(180, 190), p(180, 324), 0, 'bottom')];
    expect(whiteCorridor([], {}, barrier)).toBeNull();
  });

  it('can solve the three-color study, reusing and splitting the first boundary', () => {
    let s = newSession('03');
    s = draw(draw(draw(s, p(180, 84), p(84, 84)), p(84, 84), p(84, 276)), p(84, 276), p(180, 276));
    s = paintAt(s, p(132, 180), 'vermilion');
    s = draw(draw(draw(s, p(180, 84), p(276, 84)), p(276, 84), p(276, 180)), p(276, 180), p(180, 180));
    s = paintAt(s, p(228, 132), 'indigo');
    s = draw(draw(s, p(180, 276), p(276, 276)), p(276, 276), p(276, 180));
    s = paintAt(s, p(228, 228), 'ochre');
    expect(s.moves).toBe(11);
    expect(evaluate(s).done).toBe(true);
    expect(new Set(Object.values(s.paints)).size).toBe(3);
  });

  it('round-trips saved sessions and detects corrupt data', () => {
    const s = firstStudy();
    const data = { version: 1, sessions: { '01': s }, active: '01', artworks: [], helpSeen: true, sound: false };
    expect(parseStore(JSON.stringify(data))).toEqual(data);
    expect(() => parseStore('{bad')).toThrow();
    expect(() => parseStore(JSON.stringify({ ...data, sessions: { bad: { edges: [] } } }))).toThrow();
  });
});
