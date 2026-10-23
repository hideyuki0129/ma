import { addEdge, adjacent, getFaces, inheritPaints, makeEdge, validateEdges, whiteCorridor, type Edge, type Face, type Ink, type Paints, type Point } from './geometry';

export const INKS = {
  vermilion: { name: '朱', hex: '#c35a43' },
  indigo: { name: '藍', hex: '#34566b' },
  ochre: { name: '黄土', hex: '#cea452' },
} satisfies Record<Ink, { name: string; hex: string }>;

export type StudyId = '01' | '02' | '03' | 'free';
export type Study = { id: StudyId; title: string; subtitle: string; theme: string; note: string; limit: number | null; goals: [string, string]; seeds: Edge[] };
export const STUDIES: Study[] = [
  { id: '01', title: 'ふたつの、あわい。', subtitle: 'ひとつの線を、ふたつの形で分けあう。', theme: '隣りあう', note: '最初の弧を境界に、両側へ面をつくってみましょう。色は同じでも、違っても。', limit: 12, goals: ['色面が、境界を分けあう', '二面を、同じくらいの大きさに'], seeds: [makeEdge({ x: 180, y: 84 }, { x: 180, y: 276 }, 1, 'seed-01')] },
  { id: '02', title: '余白の、通りみち。', subtitle: '形と形のあいだに、風を通す。', theme: '離して置く', note: '上下に色面をひとつずつ。紙の中央を、左右につながる余白が通ります。', limit: 12, goals: ['色面を、上と下にひとつずつ', '中央に、幅のある余白を通す'], seeds: [makeEdge({ x: 84, y: 84 }, { x: 228, y: 84 }, 1, 'seed-02a'), makeEdge({ x: 132, y: 276 }, { x: 276, y: 276 }, -1, 'seed-02b')] },
  { id: '03', title: '線は、意味を変える。', subtitle: '昨日の輪郭が、となりの形になる。', theme: 'つながり直す', note: '三色の面をつくり、そのうちひとつを、ほかの二面につなげます。', limit: 12, goals: ['朱・藍・黄土の、三面をつくる', 'ひとつの面が、二面に触れる'], seeds: [makeEdge({ x: 180, y: 84 }, { x: 180, y: 276 }, 0, 'seed-03')] },
  { id: 'free', title: 'ただ、思うままに。', subtitle: '線も、色も、余白も。あなたの感覚で。', theme: '自由制作', note: '手数も、課題もありません。自分が好きだと思えたところで、一枚を残しましょう。', limit: null, goals: ['好きなところから、はじめる', '好きなところで、完成にする'], seeds: [] },
];
export const getStudy = (id: StudyId) => STUDIES.find(s => s.id === id)!;

export type Snapshot = { edges: Edge[]; paints: Paints; moves: number };
export type Session = Snapshot & { id: string; studyId: StudyId; startedAt: string; updatedAt: string; past: Snapshot[]; future: Snapshot[]; galleryId?: string };
export type Artwork = { id: string; title: string; date: string; studyId: StudyId; snapshot: Snapshot };
export type Store = { version: 1; sessions: Record<string, Session>; active: string | null; artworks: Artwork[]; helpSeen: boolean; sound: boolean };
export type Goal = { done: boolean; label: string; detail: string };
export type Evaluation = { goals: Goal[]; done: boolean; corridor: Point[] | null };

export function newSession(studyId: StudyId, id: string = studyId): Session {
  const now = new Date().toISOString();
  return { id, studyId, edges: structuredClone(getStudy(studyId).seeds), paints: {}, moves: 0, startedAt: now, updatedAt: now, past: [], future: [] };
}

export const snapshot = (s: Snapshot): Snapshot => structuredClone({ edges: s.edges, paints: s.paints, moves: s.moves });
export const remaining = (s: Session): number | null => getStudy(s.studyId).limit === null ? null : getStudy(s.studyId).limit! - s.moves;
function commit(s: Session, next: Snapshot): Session {
  return { ...s, ...next, updatedAt: new Date().toISOString(), past: [...s.past, snapshot(s)], future: [] };
}
const budgetError = (s: Session) => remaining(s) === 0 ? '12手になりました。「戻す」で手数も戻せます。' : null;
export type Change = { session: Session; error: string | null; createdFace?: boolean };

export function drawLine(s: Session, a: Point, b: Point, bend: number): Change {
  const error = budgetError(s);
  if (error) return { session: s, error };
  const result = addEdge(s.edges, makeEdge(a, b, bend));
  if (result.error) return { session: s, error: result.error };
  const before = getFaces(s.edges), after = getFaces(result.edges);
  const paints = inheritPaints(before, after, s.paints);
  return { session: commit(s, { edges: result.edges, paints, moves: s.moves + 1 }), error: null, createdFace: after.length > before.length };
}

export function bendLine(s: Session, id: string, bend: number): Change {
  const old = s.edges.find(e => e.id === id);
  if (!old) return { session: s, error: '線を選んでください。' };
  const edge = makeEdge(old.a, old.b, bend, old.id);
  if (Math.hypot(edge.c.x - old.c.x, edge.c.y - old.c.y) < 0.01) return { session: s, error: null };
  const error = budgetError(s);
  if (error) return { session: s, error };
  const edges = s.edges.map(e => e.id === id ? edge : e);
  const invalid = validateEdges(edges);
  if (invalid) return { session: s, error: invalid };
  const paints = inheritPaints(getFaces(s.edges), getFaces(edges), s.paints);
  return { session: commit(s, { edges, paints, moves: s.moves + 1 }), error: null };
}

export function paintFace(s: Session, faceKey: string, ink: Ink | null): Change {
  if (!getFaces(s.edges).some(f => f.key === faceKey)) return { session: s, error: '閉じた面をタップしてください。' };
  if ((s.paints[faceKey] ?? null) === ink) return { session: s, error: null };
  const error = budgetError(s);
  if (error) return { session: s, error };
  const paints = { ...s.paints };
  if (ink === null) delete paints[faceKey]; else paints[faceKey] = ink;
  return { session: commit(s, { edges: s.edges, paints, moves: s.moves + 1 }), error: null };
}

export function undo(s: Session): Session {
  const prev = s.past.at(-1);
  return prev ? { ...s, ...snapshot(prev), past: s.past.slice(0, -1), future: [snapshot(s), ...s.future], updatedAt: new Date().toISOString() } : s;
}
export function redo(s: Session): Session {
  const next = s.future[0];
  return next ? { ...s, ...snapshot(next), past: [...s.past, snapshot(s)], future: s.future.slice(1), updatedAt: new Date().toISOString() } : s;
}

export function evaluate(s: Pick<Session, 'studyId' | 'edges' | 'paints'>, faces = getFaces(s.edges)): Evaluation {
  const study = getStudy(s.studyId), colored = faces.filter(f => s.paints[f.key] && f.area >= 1000);
  let first = false, second = false, detail1 = '', detail2 = '', corridor: Point[] | null = null;
  if (s.studyId === '01') {
    const pairs: [Face, Face][] = [];
    for (let i = 0; i < colored.length; i++) for (let j = i + 1; j < colored.length; j++) if (adjacent(colored[i], colored[j])) pairs.push([colored[i], colored[j]]);
    first = pairs.length > 0;
    second = pairs.some(([a, b]) => Math.min(a.area, b.area) / Math.max(a.area, b.area) >= 0.5);
    detail1 = first ? '同じ線が、ふたつの輪郭に。' : '閉じた面に色を置き、共通の線をつくる。';
    detail2 = first ? `面積比 ${Math.max(...pairs.map(([a, b]) => Math.min(a.area, b.area) / Math.max(a.area, b.area))).toFixed(2)} : 1 ／ 0.5以上で成立` : '目安は、面積比 1:2〜2:1。小さすぎる面は数えません。';
  } else if (s.studyId === '02') {
    first = colored.some(a => a.center.y < 160 && colored.some(b => b !== a && b.center.y > 200 && !adjacent(a, b)));
    corridor = whiteCorridor(faces, s.paints, s.edges);
    second = first && corridor !== null;
    detail1 = first ? '離れた形が、向かいあう。' : '上半分と下半分に、触れあわない色面を。';
    detail2 = second ? '幅のある余白が、左右につながりました。' : '中央の帯の中に、約18px以上の通りみちを。';
  } else if (s.studyId === '03') {
    first = new Set(colored.map(f => s.paints[f.key])).size === 3;
    second = first && colored.some(a => colored.filter(b => b !== a && adjacent(a, b)).length >= 2);
    detail1 = first ? '三色それぞれに、居場所ができました。' : '閉じた面に、三色をひとつずつ。';
    detail2 = second ? 'ひとつの形が、ふたつのとなりに。' : '一本の線を、となりの面の境界にする。';
  } else {
    first = s.edges.length > 0;
    second = true;
    detail1 = '手数に制限はありません。'; detail2 = '美しさを採点する人はいません。';
  }
  return { goals: [{ done: first, label: study.goals[0], detail: detail1 }, { done: second, label: study.goals[1], detail: detail2 }], done: first && second, corridor };
}

export const STORAGE_KEY = 'ma.studio.v1';
export const emptyStore = (): Store => ({ version: 1, sessions: {}, active: null, artworks: [], helpSeen: false, sound: false });
const isPoint = (p: unknown): p is Point => !!p && typeof p === 'object' && ['x', 'y'].every(k => typeof (p as Record<string, unknown>)[k] === 'number' && Number.isFinite((p as Record<string, number>)[k]));
function isSnapshot(s: unknown): s is Snapshot {
  if (!s || typeof s !== 'object') return false;
  const v = s as Snapshot;
  return Array.isArray(v.edges) && v.edges.every(e => typeof e.id === 'string' && isPoint(e.a) && isPoint(e.b) && isPoint(e.c)) && !!v.paints && typeof v.paints === 'object' && Object.values(v.paints).every(p => Object.hasOwn(INKS, p)) && Number.isInteger(v.moves) && v.moves >= 0;
}
export function parseStore(raw: string | null): Store {
  if (!raw) return emptyStore();
  const data = JSON.parse(raw) as Store;
  if (!data || data.version !== 1 || !data.sessions || !Array.isArray(data.artworks)) throw new Error('保存データの形式が異なります。');
  for (const s of Object.values(data.sessions)) {
    if (!isSnapshot(s) || !STUDIES.some(x => x.id === s.studyId) || !Array.isArray(s.past) || !Array.isArray(s.future) || !s.past.every(isSnapshot) || !s.future.every(isSnapshot)) throw new Error('制作データを読み取れませんでした。');
  }
  if (!data.artworks.every(a => typeof a.id === 'string' && typeof a.title === 'string' && typeof a.date === 'string' && STUDIES.some(x => x.id === a.studyId) && isSnapshot(a.snapshot))) throw new Error('作品データを読み取れませんでした。');
  if (data.active && !data.sessions[data.active]) data.active = null;
  return data;
}
