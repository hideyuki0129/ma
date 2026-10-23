import './style.css';
import { addEdge, curveValue, distance, edgePath, facePath, getFaces, GRID, inFace, makeEdge, nearestOnEdge, samePoint, snapPoint, validateEdges, type Edge, type Ink, type Point } from './geometry';
import { artSvg, escapeHtml as esc, exportArt } from './art';
import { bendLine, drawLine, emptyStore, evaluate, getStudy, INKS, newSession, paintFace, parseStore, redo, remaining, snapshot, STORAGE_KEY, STUDIES, undo, type Artwork, type Change, type Session, type Store, type StudyId } from './model';

const icons: Record<string, string> = {
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  back: '<path d="m14 5-7 7 7 7"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 3h.01"/>',
  gallery: '<rect x="4" y="4" width="6" height="6" rx=".6"/><rect x="14" y="4" width="6" height="6" rx=".6"/><rect x="4" y="14" width="6" height="6" rx=".6"/><path d="M14 17h6m-3-3v6"/>',
  pen: '<path d="m5 17-1 3 3-1L19 7a2.1 2.1 0 0 0-3-3ZM14 6l4 4"/>',
  curve: '<path d="M5 18Q3 4 19 6"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="6" r="2"/>',
  paint: '<path d="m10 3 9 9-7 7a4 4 0 0 1-6 0l-3-3 9-9M5 14h12m3 2s-2 2.5-2 3.5a2 2 0 0 0 4 0c0-1-2-3.5-2-3.5Z"/>',
  undo: '<path d="m9 5-5 5 5 5m-5-5h9a6 6 0 0 1 0 12"/>',
  redo: '<path d="m15 5 5 5-5 5m5-5h-9a6 6 0 0 0 0 12"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  reset: '<path d="M4 10a8 8 0 1 1 1 7M4 4v6h6"/>',
  down: '<path d="m8 10 4 4 4-4"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  sound: '<path d="M4 9h4l5-4v14l-5-4H4Zm13-1a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  mute: '<path d="M4 9h4l5-4v14l-5-4H4Zm13 0 5 6m-5 0 5-6"/>',
  flower: '<path d="M12 12C-2 2 12-3 12 12c0-15 14-10 0 0 14-10 19 4 0 0 19 4 5 18 0 0 5 18-9 13 0 0-9 13-14-1 0 0Z"/>',
};
const icon = (name: string, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? ''}</svg>`;
const app = document.querySelector<HTMLDivElement>('#app')!;
const dialogRoot = document.querySelector<HTMLDivElement>('#dialog-root')!;
let storageWarning = false;
let store: Store;
try { store = parseStore(localStorage.getItem(STORAGE_KEY)); }
catch {
  store = emptyStore(); storageWarning = true;
  try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) localStorage.setItem(`${STORAGE_KEY}.recovery`, raw); } catch { /* Keep the original if storage is unavailable. */ }
}
type Screen = 'home' | 'play' | 'gallery';
type Tool = 'draw' | 'bend' | 'paint';
let screen: Screen = location.hash === '#play' ? 'play' : location.hash === '#gallery' ? 'gallery' : 'home';
let tool: Tool = 'draw', bend = 0, draft: Point[] = [], selectedEdge: string | null = null, ink: Ink | null = 'vermilion';
let sheet: string | null = null, activeArtId: string | null = null, toastTimer = 0, lastFocus: string | null = null;
let audio: AudioContext | null = null;
let pointerStart: Point | null = null, ignoreClick = false;

function save(): boolean {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); return true; }
  catch { storageWarning = true; toast('ブラウザに保存できませんでした。大切な作品は画像で保存してください。', 6500); return false; }
}
function current(): Session {
  if (!store.active || !store.sessions[store.active]) {
    store.active = '01'; store.sessions['01'] ??= newSession('01');
  }
  return store.sessions[store.active];
}
function resetTools(): void { draft = []; selectedEdge = null; bend = 0; tool = 'draw'; }
function navigate(next: Screen): void {
  screen = next;
  const hash = next === 'home' ? '' : `#${next}`;
  if (location.hash !== hash) history.pushState(null, '', `${location.pathname}${location.search}${hash}`);
  render(); window.scrollTo(0, 0);
}
function startStudy(id: StudyId): void {
  const latest = id === 'free' ? Object.values(store.sessions).filter(s => s.studyId === 'free').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] : null;
  if (!latest) store.sessions[id] ??= newSession(id);
  store.active = latest?.id ?? id; resetTools(); closeSheet(); save(); navigate('play');
}
function toast(text: string, duration = 3400): void {
  const el = document.querySelector<HTMLDivElement>('#toast')!;
  window.clearTimeout(toastTimer); el.textContent = text; el.classList.add('visible');
  toastTimer = window.setTimeout(() => el.classList.remove('visible'), duration);
}
function feedback(complete = false): void {
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) navigator.vibrate?.(complete ? [10, 35, 10] : 8);
  if (!store.sound) return;
  try {
    audio ??= new AudioContext(); void audio.resume();
    const now = audio.currentTime;
    for (const [i, frequency] of (complete ? [440, 554.37, 659.25] : [440]).entries()) {
      const osc = audio.createOscillator(), gain = audio.createGain();
      osc.type = 'sine'; osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0, now + i * 0.09); gain.gain.linearRampToValueAtTime(0.055, now + i * 0.09 + 0.015); gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.09 + 0.6);
      osc.connect(gain); gain.connect(audio.destination); osc.start(now + i * 0.09); osc.stop(now + i * 0.09 + 0.65);
    }
  } catch { /* Sound is optional; a browser may disallow audio. */ }
}

const heroArt = () => `<svg viewBox="0 0 360 340" aria-label="曲線を分けあう朱、藍、黄土の三つの面" role="img"><g fill="none" stroke="#cbc6b9" stroke-width=".6"><path d="M22 34h10m-5-5v10M328 306h10m-5-5v10"/></g><g stroke="#2b302d" stroke-width="3.5" stroke-linejoin="round"><path d="M60 48H184Q108 168 184 288H60Q110 168 60 48Z" fill="#c35a43"/><path d="M184 48H300V168H146Q146 108 184 48Z" fill="#cea452"/><path d="M146 168H300Q252 228 300 288H184Q146 228 146 168Z" fill="#34566b"/></g><circle cx="184" cy="48" r="4" fill="#2b302d"/><circle cx="146" cy="168" r="4" fill="#2b302d"/><circle cx="184" cy="288" r="4" fill="#2b302d"/><text x="27" y="324" fill="#8a8b7e" font-family="serif" font-size="7.5" letter-spacing="1.8">A STUDY OF SPACE</text><text x="333" y="324" text-anchor="end" fill="#8a8b7e" font-family="serif" font-size="8" letter-spacing="1.5">NO. 001</text></svg>`;

function header(): string {
  return `<header class="header"><button class="brand" data-action="home" aria-label="間 — MA ホーム"><span class="brand-kanji">間</span><span class="brand-latin">MA<span>A STUDY OF SPACE</span></span></button><nav class="header-actions" aria-label="メニュー">${screen === 'play' ? `<button class="icon-button sound-button" data-action="sound" aria-label="音を${store.sound ? 'オフ' : 'オン'}にする" aria-pressed="${store.sound}">${icon(store.sound ? 'sound' : 'mute')}</button>` : ''}<button class="icon-button ${screen === 'gallery' ? 'is-current' : ''}" data-action="gallery" aria-label="作品集">${icon('gallery')}</button><button class="icon-button" data-action="help" aria-label="遊びかた">${icon('help')}</button></nav></header>`;
}

function home(): string {
  const active = store.active ? store.sessions[store.active] : null;
  const resume = active && active.moves > 0;
  const complete = new Set(store.artworks.map(a => a.studyId));
  return `<main class="home"><div class="eyebrow"><span class="tiny-rule"></span> 線と余白の、小さなゲーム</div><h1>線を置く。<br>余白が、生まれる。</h1><p class="home-description">曲げて、つないで、少し戻して。<br>その手の先に、あなたの一枚を。</p><div class="home-art paper">${heroArt()}<span class="art-caption">余白は、まだ、あなたのもの。</span></div><div class="home-meta"><span>CURVE <i>×</i> COLOR <i>×</i> SPACE</span><span>時間制限なし</span></div><button class="primary home-start" data-action="${resume ? 'continue' : 'start'}"><span>${resume ? 'つづきの一線を' : '最初の一線を'}</span>${icon('arrow')}</button><button class="text-button study-link" data-action="studies">3つの習作と、自由な制作 ${icon('down')}</button><div class="study-progress" aria-label="習作の進み具合">${STUDIES.slice(0, 3).map(s => `<span class="${complete.has(s.id) ? 'complete' : ''}">${complete.has(s.id) ? icon('check') : `<i>${s.id}</i>`}<span>${s.theme}</span></span>`).join('<b>—</b>')}</div><footer class="home-footer"><span>正解は、ひとつじゃない。</span><span class="vertical-dash">MA · 2026</span></footer></main>`;
}

function pending(): { edges: Edge[] | null; error: string | null; changed: boolean } {
  const s = current();
  if (tool === 'draw' && draft.length === 2) {
    const r = addEdge(s.edges, makeEdge(draft[0], draft[1], bend, 'preview'));
    return { edges: r.edges, error: r.error, changed: true };
  }
  if (tool === 'bend' && selectedEdge) {
    const old = s.edges.find(e => e.id === selectedEdge)!;
    const edge = makeEdge(old.a, old.b, bend, old.id);
    const edges = s.edges.map(e => e.id === selectedEdge ? edge : e);
    return { edges, error: validateEdges(edges), changed: distance(old.c, edge.c) > 0.01 };
  }
  return { edges: null, error: null, changed: false };
}

function board(s: Session): string {
  const preview = pending(), renderEdges = tool === 'bend' && preview.edges && !preview.error ? preview.edges : s.edges;
  const faces = getFaces(renderEdges), endpoints = [...new Map(s.edges.flatMap(e => [e.a, e.b]).map(p => [`${p.x},${p.y}`, p])).values()];
  return `<svg id="board" class="board tool-${tool}" viewBox="0 0 360 360" role="group" aria-label="制作の紙。点をふたつ選んで線をつなぎます。"><rect width="360" height="360" fill="#fbf9f3"/><g class="registration" fill="none" stroke="#c9c6bb" stroke-width=".65"><path d="M14 24V14H24M336 14H346V24M346 336V346H336M24 346H14V336"/></g><g class="grid-dots">${GRID.map(p => `<circle cx="${p.x}" cy="${p.y}" r="1.5"/>`).join('')}</g><g class="faces">${faces.map(f => `<path d="${facePath(f)}" fill="${s.paints[f.key] ? INKS[s.paints[f.key]].hex : '#fbf9f3'}" fill-rule="evenodd" class="face ${s.paints[f.key] ? 'colored' : 'unpainted'}" data-face="${esc(f.key)}" ${tool === 'paint' ? `tabindex="0" role="button" aria-label="${s.paints[f.key] ? INKS[s.paints[f.key]].name : 'まだ色のない'}面を${ink ? INKS[ink].name : '余白'}にする"` : ''}/>`).join('')}</g><g class="drawn-lines">${renderEdges.map(e => `<path d="${edgePath(e)}" class="drawn-line ${selectedEdge === e.id ? 'selected-line' : ''}"/>`).join('')}</g>${tool === 'draw' && draft.length === 2 ? `<path class="preview-line ${preview.error ? 'invalid' : ''}" d="${edgePath(makeEdge(draft[0], draft[1], bend, 'preview'))}"/>` : ''}${tool !== 'paint' ? `<g class="endpoints">${endpoints.map(p => `<circle cx="${p.x}" cy="${p.y}" r="3.7"/>`).join('')}</g>` : ''}${tool === 'draw' ? `<g class="point-targets">${GRID.map((p, i) => `<circle cx="${p.x}" cy="${p.y}" r="20" fill="transparent" data-grid="${i}" tabindex="0" role="button" aria-label="${Math.floor(i / 7) + 1}行 ${i % 7 + 1}列の点"/>`).join('')}</g>` : ''}${tool === 'bend' ? s.edges.map((e, i) => `<path d="${edgePath(e)}" class="edge-target" data-edge="${esc(e.id)}" tabindex="0" role="button" aria-label="線${i + 1}を曲げる"/>`).join('') : ''}<g class="selection-markers">${draft.map(p => `<circle cx="${p.x}" cy="${p.y}" r="11" class="selection-ring"/><circle cx="${p.x}" cy="${p.y}" r="3.5" class="selection-dot"/>`).join('')}${tool === 'bend' && selectedEdge ? [s.edges.find(e => e.id === selectedEdge)!.a, s.edges.find(e => e.id === selectedEdge)!.b].map(p => `<circle cx="${p.x}" cy="${p.y}" r="7" class="edit-ring"/>`).join('') : ''}</g></svg>`;
}

function play(): string {
  const s = current(), study = getStudy(s.studyId), faces = getFaces(s.edges), evaluation = evaluate(s, faces), left = remaining(s), preview = pending();
  let hint = '';
  if (preview.error) hint = preview.error;
  else if (tool === 'draw' && draft.length === 1) hint = 'もうひとつの点を選んでください。';
  else if (tool === 'draw' && draft.length === 2) hint = 'ふくらみを選び、よければ「線を置く」。';
  else if (tool === 'bend' && !selectedEdge) hint = '曲げたい線をタップ。両側の形も変わります。';
  else if (tool === 'bend') hint = 'ふくらみを試して、好きなところで決める。';
  else if (tool === 'paint') hint = faces.length ? '色を選び、閉じた面をタップしてください。' : 'まだ面がありません。線をつないで輪を閉じましょう。';
  else if (evaluation.done) hint = '条件が整いました。仕上げる余地は、まだあります。';
  else if (left === 0) hint = '12手になりました。「戻す」で手数も戻せます。';
  else if (s.studyId === '01' && s.moves === 0) hint = '弧の端と、好きな点。まずは一線、つないでみる。';
  else if (s.studyId === '01' && !faces.length) hint = '線をもう一本つないで、輪を閉じてみましょう。';
  else hint = '点をふたつタップ。閉じた輪が、色の面になる。';
  const committing = tool === 'draw' && draft.length === 2 || tool === 'bend' && selectedEdge !== null && preview.changed;
  const canCommit = !preview.error && left !== 0;
  return `<main class="play"><section class="study-heading"><div><button class="eyebrow study-selector" data-action="studies">${s.studyId === 'free' ? 'OPEN STUDIO' : `STUDY ${s.studyId} / 03`} ${icon('down')}</button><h1>${study.title}</h1><p>${study.subtitle}</p></div><span class="study-seal" aria-hidden="true">${s.studyId === 'free' ? '自由' : study.id}</span></section>${s.studyId !== 'free' ? `<button class="goals ${evaluation.done ? 'all-done' : ''}" data-action="goals" aria-label="今回の課題。${evaluation.goals.filter(g => g.done).length} / 2 達成"><span class="goal-list">${evaluation.goals.map(g => `<span class="goal-row ${g.done ? 'done' : ''}"><span class="goal-check">${g.done ? icon('check') : ''}</span><span>${g.label}</span></span>`).join('')}</span><span class="goal-count">${evaluation.goals.filter(g => g.done).length}<i>/ 2</i></span></button>` : `<div class="free-note">${icon('flower')} うまく作ろうとしなくて、大丈夫。</div>`}<div class="paper board-paper">${board(s)}</div><div class="board-meta"><span>${tool === 'paint' ? 'COLOR THE CLOSED SHAPE' : tool === 'bend' ? 'RESHAPE THE BOUNDARY' : 'CONNECT TWO POINTS'}</span><span>${left === null ? `${s.moves} 手 · 制限なし` : `のこり ${left} 手`}</span></div><p class="instruction ${preview.error ? 'instruction-error' : ''}" role="status">${hint}</p><section class="tools" aria-label="制作の道具"><div class="tool-tabs" role="tablist" aria-label="道具を選ぶ">${([['draw', 'pen', '線を置く'], ['bend', 'curve', '線を曲げる'], ['paint', 'paint', '色を置く']] as const).map(([value, symbol, label]) => `<button role="tab" aria-selected="${tool === value}" class="tool-tab ${tool === value ? 'active' : ''}" data-action="tool" data-tool="${value}">${icon(symbol)}<span>${label}</span></button>`).join('')}</div><div class="tool-options" role="tabpanel" aria-label="${tool === 'paint' ? '色' : '線のふくらみ'}">${tool === 'paint' ? `<span class="option-label">色を選ぶ</span><div class="palette" role="group" aria-label="色">${(Object.entries(INKS) as [Ink, typeof INKS[Ink]][]).map(([key, color]) => `<button class="swatch ${ink === key ? 'selected' : ''}" style="--swatch:${color.hex}" data-action="ink" data-ink="${key}" aria-label="${color.name}" aria-pressed="${ink === key}"><span>${ink === key ? icon('check') : ''}</span><i>${color.name}</i></button>`).join('')}<button class="swatch erase ${ink === null ? 'selected' : ''}" data-action="ink" data-ink="paper" aria-label="余白に戻す" aria-pressed="${ink === null}"><span>${ink === null ? icon('check') : ''}</span><i>余白</i></button></div>` : `<span class="option-label">ふくらみ<span>${['大きく右', '少し右', 'まっすぐ', '少し左', '大きく左'][bend + 2] ?? 'まっすぐ'}</span></span><div class="curve-choices" role="group" aria-label="線のふくらみ">${[-2, -1, 0, 1, 2].map(value => `<button class="curve-choice ${bend === value ? 'selected' : ''}" data-action="bend" data-bend="${value}" aria-label="${['大きく右に曲げる', '少し右に曲げる', 'まっすぐにする', '少し左に曲げる', '大きく左に曲げる'][value + 2]}" aria-pressed="${bend === value}"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 6Q${16 - value * 7} 16 16 26"/><circle cx="16" cy="6" r="1.5"/><circle cx="16" cy="26" r="1.5"/></svg></button>`).join('')}</div>`}</div></section><div class="action-bar"><div class="history-controls"><button class="icon-button" data-action="undo" aria-label="一手戻す" ${!s.past.length && !draft.length && !selectedEdge ? 'disabled' : ''}>${icon('undo')}</button><button class="icon-button" data-action="redo" aria-label="一手やり直す" ${!s.future.length || draft.length ? 'disabled' : ''}>${icon('redo')}</button></div><button class="primary finish-button ${!committing && evaluation.done ? 'ready' : ''}" data-action="${committing ? 'commit' : 'finish'}" ${committing ? canCommit ? '' : 'disabled' : evaluation.done && !draft.length ? '' : 'disabled'}>${committing ? tool === 'bend' ? 'この曲がりにする' : 'この線を置く' : 'この一枚を残す'}${icon(committing ? 'arrow' : 'check')}</button></div><div class="play-footer"><button class="text-button" data-action="reset">${icon('reset')} はじめから</button><span>${icon('check')} 自動保存${storageWarning ? 'を確認してください' : 'しています'}</span></div></main>`;
}

function gallery(): string {
  return `<main class="gallery"><div class="eyebrow"><span class="tiny-rule"></span> YOUR COLLECTION</div><div class="gallery-heading"><h1>残した、間。</h1><span>${String(store.artworks.length).padStart(2, '0')} <i>作品</i></span></div><p class="gallery-description">同じ一枚は、ふたつとない。<br>選んだ線と、そのときの余白。</p>${store.artworks.length ? `<div class="gallery-grid">${[...store.artworks].reverse().map(a => `<button class="art-card" data-action="art" data-id="${esc(a.id)}"><div class="paper art-thumbnail">${artSvg(a.snapshot, a.title)}</div><span class="art-number">${a.studyId === 'free' ? 'OPEN STUDIO' : `STUDY ${a.studyId}`}</span><strong>${esc(a.title)}</strong><span class="art-date">${formatDate(a.date)} · ${a.snapshot.moves}手</span></button>`).join('')}</div>` : `<div class="empty-gallery"><span class="empty-frame">${icon('curve')}</span><h2>まだ、余白のまま。</h2><p>最初の一枚が、ここに並びます。<br>好きなところから、はじめましょう。</p><button class="primary" data-action="start">一枚、つくる ${icon('arrow')}</button></div>`}<div class="gallery-bottom"><button class="text-button" data-action="studies">新しい一枚をつくる ${icon('arrow')}</button><p>作品はこのブラウザに保存されます。<br>大切な一枚は、画像でも手元に。</p></div></main>`;
}

function render(): void {
  const focusElement = document.activeElement as HTMLElement;
  const focusData = focusElement?.dataset.action ? Object.entries(focusElement.dataset).filter(([key]) => ['action', 'tool', 'bend', 'ink', 'id'].includes(key)) : [];
  app.innerHTML = `<aside class="desktop-note" aria-hidden="true"><div class="desktop-wordmark">間<span>MA</span></div><p>形のあいだに、<br>あなたの選んだ余白がある。</p><span class="desktop-rule"></span><small>線と色で、考える。<br>AN EXERCISE IN SEEING</small></aside><div class="shell screen-${screen}">${header()}${screen === 'home' ? home() : screen === 'play' ? play() : gallery()}</div><aside class="desktop-colophon" aria-hidden="true"><span>01 — OBSERVE<br>02 — COMPOSE<br>03 — MAKE IT YOURS</span><p>急がなくて、いい。</p><i>© MA STUDIO, 2026</i></aside>`;
  if (focusData.length) app.querySelector<HTMLElement>(focusData.map(([key, value]) => `[data-${key}="${CSS.escape(value!)}"]`).join(''))?.focus({ preventScroll: true });
}

const formatDate = (date: string) => {
  try { return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Tokyo' }).format(new Date(date)); }
  catch { return ''; }
};

function sheetContent(kind: string): string {
  const s = current(), study = getStudy(s.studyId);
  if (kind === 'help') return `<div class="sheet-eyebrow">HOW TO PLAY</div><h2 id="sheet-title">線をつなぐ。<br>その先を、見てみる。</h2><div class="help-steps"><div><span>01</span><svg viewBox="0 0 72 52" aria-hidden="true"><path d="M12 40Q36 0 60 12"/><circle cx="12" cy="40" r="3"/><circle cx="60" cy="12" r="3"/></svg><section><h3>点をふたつ、タップ。</h3><p>端点を選び、ふくらみを決めて線を置きます。線の上にもつなげます。</p></section></div><div><span>02</span><svg viewBox="0 0 72 52" aria-hidden="true"><path d="M12 40Q36 0 60 12V40Z" fill="#c35a43"/></svg><section><h3>閉じたら、色を。</h3><p>輪を閉じると面ができます。「色を置く」で色を選び、面をタップ。</p></section></div><div><span>03</span><svg viewBox="0 0 72 52" aria-hidden="true"><path d="M12 40Q36 0 60 12M12 40 60 40 60 12"/><path d="M12 40Q25 20 60 12" stroke-dasharray="3 3" stroke="#c35a43"/></svg><section><h3>曲げて、戻して、選ぶ。</h3><p>「線を曲げる」で境界を編集。取り消しは何度でも、手数も戻ります。</p></section></div></div><div class="help-note">線を置く・曲げる・色を変える操作が各1手。<br>12手の中で2つの条件を満たしたら、好きなところで完成。美しさの採点や時間制限はありません。</div><p class="storage-note">制作はこのブラウザに自動保存します。<br>大切な作品は、PNG・SVGでも保存できます。</p><button class="primary full" data-action="close">${screen === 'play' ? '描いてみる' : 'わかった'} ${icon('arrow')}</button>`;
  if (kind === 'studies') return `<div class="sheet-eyebrow">CHOOSE A STUDY</div><h2 id="sheet-title">今日は、どんな間を。</h2><p class="sheet-description">順番どおりでなくても、大丈夫。<br>描きかけの習作は、そのまま残ります。</p><div class="study-list">${STUDIES.map(x => `<button data-action="choose-study" data-id="${x.id}"><span class="list-index">${x.id === 'free' ? '∞' : x.id}</span><span><strong>${x.title}</strong><small>${x.id === 'free' ? '課題も手数もない、自由な制作' : x.theme + ' · 12手の習作'}</small></span><span class="list-check">${store.artworks.some(a => a.studyId === x.id) ? icon('check') : icon('arrow')}</span></button>`).join('')}</div>`;
  if (kind === 'goals') {
    const e = evaluate(s);
    return `<div class="sheet-eyebrow">${s.studyId === 'free' ? 'OPEN STUDIO' : `STUDY ${s.studyId}`}</div><h2 id="sheet-title">${study.title}</h2><p class="sheet-description">${study.note}</p><div class="goal-details">${e.goals.map(g => `<div class="${g.done ? 'done' : ''}"><span class="goal-check">${g.done ? icon('check') : ''}</span><section><h3>${g.label}</h3><p>${g.detail}</p></section></div>`).join('')}</div><p class="storage-note">紙の枠は、面を閉じる線にはなりません。<br>外側に余白を残すため、線は枠の少し内側まで。<br>成立したあと、整えるかどうかはあなた次第です。</p><button class="primary full" data-action="close">つづける ${icon('arrow')}</button>`;
  }
  if (kind === 'reset') return `<div class="sheet-eyebrow">A FRESH START</div><h2 id="sheet-title">もう一度、<br>まっさらな気持ちで。</h2><p class="sheet-description">この描きかけの習作を、最初の状態に戻します。作品集に残した一枚は消えません。</p><button class="primary full" data-action="confirm-reset">はじめから描く ${icon('reset')}</button><button class="text-button full" data-action="close">このまま、つづける</button>`;
  if (kind === 'finish') {
    const previous = store.artworks.find(a => a.id === s.galleryId);
    return `<div class="sheet-eyebrow">YOUR COMPOSITION</div><h2 id="sheet-title">この間を、残す。</h2><p class="sheet-description">ここで手を止めるのも、ひとつの選択。</p><div class="paper finish-preview">${artSvg(s, previous?.title ?? study.title)}</div><form data-form="finish"><label class="title-label" for="art-title">作品の名前<span>あとから、また描き直せます。</span></label><input id="art-title" name="title" maxlength="24" value="${esc(previous?.title ?? study.title)}" autocomplete="off" required/><button class="primary full" type="submit">作品集に残す ${icon('check')}</button></form>`;
  }
  if (kind === 'saved' || kind === 'art') {
    const a = store.artworks.find(a => a.id === activeArtId);
    if (!a) return '';
    return `<div class="sheet-eyebrow">${kind === 'saved' ? 'A MOMENT, KEPT.' : a.studyId === 'free' ? 'OPEN STUDIO' : `STUDY ${a.studyId}`}</div><h2 id="sheet-title">${kind === 'saved' ? 'あなたが選んだ、一枚。' : esc(a.title)}</h2><div class="paper detail-preview">${artSvg(a.snapshot, a.title)}</div><div class="detail-caption"><strong>${esc(a.title)}</strong><span>${formatDate(a.date)} · ${a.snapshot.moves}手</span></div><div class="export-buttons"><button data-action="export" data-format="png">${icon('download')} PNGで保存</button><button data-action="export" data-format="svg">${icon('download')} SVGで保存</button></div>${kind === 'saved' ? `<button class="primary full" data-action="next-study">${a.studyId === '03' || a.studyId === 'free' ? '自由に、もう一枚' : '次の間へ'} ${icon('arrow')}</button><button class="text-button full" data-action="to-gallery">作品集で眺める</button>` : `<button class="primary full" data-action="resume-art">この一枚から、また描く ${icon('pen')}</button><p class="storage-note center">元の作品を残して、自由制作をはじめます。</p>`}`;
  }
  return '';
}

function openSheet(kind: string): void {
  lastFocus = (document.activeElement as HTMLElement)?.dataset.action ?? lastFocus;
  const existing = dialogRoot.querySelector('dialog'); if (existing?.open) existing.close();
  sheet = kind;
  dialogRoot.innerHTML = `<dialog class="sheet" aria-labelledby="sheet-title"><div class="sheet-handle" aria-hidden="true"></div><button class="icon-button sheet-close" data-action="close" aria-label="閉じる">${icon('close')}</button><div class="sheet-body">${sheetContent(kind)}</div></dialog>`;
  const dialog = dialogRoot.querySelector('dialog')!;
  dialog.showModal();
  dialog.addEventListener('cancel', e => { e.preventDefault(); closeSheet(); });
  dialog.addEventListener('click', e => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeSheet();
  });
  document.body.classList.add('modal-open');
  // Do not summon the phone keyboard before the player chooses to edit a title.
  dialog.querySelector<HTMLElement>('.sheet-close')?.focus({ preventScroll: true });
}

function closeSheet(): void {
  dialogRoot.querySelector('dialog')?.close(); dialogRoot.innerHTML = ''; sheet = null;
  document.body.classList.remove('modal-open');
  if (lastFocus) app.querySelector<HTMLElement>(`[data-action="${lastFocus}"]`)?.focus({ preventScroll: true });
}

function apply(change: Change): void {
  if (change.error) { toast(change.error); return; }
  const before = current(), wasDone = evaluate(before).done;
  store.sessions[before.id] = change.session; save(); draft = []; selectedEdge = null;
  if (change.createdFace) {
    tool = 'paint';
    const used = new Set(Object.values(change.session.paints));
    ink = (Object.keys(INKS) as Ink[]).find(i => !used.has(i)) ?? ink;
  }
  const done = evaluate(change.session).done;
  feedback(done && !wasDone); render();
  if (done && !wasDone) toast('条件が整いました。好きなところで、一枚を残せます。', 4500);
  else if (change.createdFace) toast('面ができました。色を選んで、面をタップ。');
}

function boardClick(event: MouseEvent, target: Element): void {
  const s = current(), svg = document.querySelector<SVGSVGElement>('#board')!;
  let p: Point;
  const gridIndex = (target.closest('[data-grid]') as SVGElement | null)?.dataset.grid;
  if (event.detail === 0 && gridIndex !== undefined) p = GRID[Number(gridIndex)];
  else {
    const r = svg.getBoundingClientRect(); p = { x: (event.clientX - r.left) / r.width * 360, y: (event.clientY - r.top) / r.height * 360 };
  }
  if (tool === 'draw') {
    const q = snapPoint(p, s.edges);
    if (!q) { if (draft.length) { draft = []; render(); } return; }
    if (draft.length === 0 || draft.length === 2) draft = [q];
    else if (samePoint(draft[0], q)) draft = [];
    else draft.push(q);
    feedback(); render();
  } else if (tool === 'bend') {
    const edgeId = (target.closest('[data-edge]') as SVGElement | null)?.dataset.edge;
    const nearest = s.edges.map(e => ({ e, distance: nearestOnEdge(e, p).distance })).sort((a, b) => a.distance - b.distance)[0];
    const edge = edgeId ? s.edges.find(e => e.id === edgeId) : nearest && nearest.distance < 18 ? nearest.e : null;
    if (edge) { selectedEdge = edge.id; bend = Math.max(-2, Math.min(2, curveValue(edge))); feedback(); render(); }
    else { selectedEdge = null; render(); }
  } else {
    const faceKey = (target.closest('[data-face]') as SVGElement | null)?.dataset.face;
    const face = getFaces(s.edges).find(f => faceKey ? f.key === faceKey : inFace(p, f));
    if (face) apply(paintFace(s, face.key, ink));
    else toast('色を置けるのは、線で閉じた面の内側です。');
  }
}

async function onClick(event: MouseEvent): Promise<void> {
  if (!(event.target instanceof Element)) return;
  const target = event.target;
  if (target.closest('#board')) {
    if (!ignoreClick) boardClick(event, target);
    ignoreClick = false; return;
  }
  const button = target.closest<HTMLElement>('[data-action]');
  if (!button || button.hasAttribute('disabled')) return;
  const action = button.dataset.action, s = screen === 'play' ? current() : null;
  if (action === 'home') { closeSheet(); navigate('home'); }
  else if (action === 'gallery' || action === 'to-gallery') { closeSheet(); navigate('gallery'); }
  else if (action === 'start') startStudy('01');
  else if (action === 'continue') { resetTools(); navigate('play'); }
  else if (action === 'help') { openSheet('help'); store.helpSeen = true; save(); }
  else if (action === 'studies') openSheet('studies');
  else if (action === 'choose-study') startStudy(button.dataset.id as StudyId);
  else if (action === 'close') closeSheet();
  else if (action === 'goals') openSheet('goals');
  else if (action === 'tool') { tool = button.dataset.tool as Tool; draft = []; selectedEdge = null; render(); }
  else if (action === 'bend') { bend = Number(button.dataset.bend); feedback(); render(); }
  else if (action === 'ink') { ink = button.dataset.ink === 'paper' ? null : button.dataset.ink as Ink; render(); }
  else if (action === 'commit' && s) {
    if (tool === 'draw' && draft.length === 2) apply(drawLine(s, draft[0], draft[1], bend));
    else if (tool === 'bend' && selectedEdge) apply(bendLine(s, selectedEdge, bend));
  } else if (action === 'undo' && s) {
    if (draft.length || selectedEdge) { draft = []; selectedEdge = null; }
    else store.sessions[s.id] = undo(s);
    save(); feedback(); render();
  } else if (action === 'redo' && s) { store.sessions[s.id] = redo(s); draft = []; selectedEdge = null; save(); feedback(); render(); }
  else if (action === 'reset') openSheet('reset');
  else if (action === 'confirm-reset') { const session = current(); store.sessions[session.id] = newSession(session.studyId, session.id); save(); resetTools(); closeSheet(); render(); }
  else if (action === 'finish' && s && evaluate(s).done) { draft = []; selectedEdge = null; openSheet('finish'); }
  else if (action === 'sound') { store.sound = !store.sound; save(); feedback(); render(); }
  else if (action === 'art') { activeArtId = button.dataset.id!; openSheet('art'); }
  else if (action === 'export') {
    const art = store.artworks.find(a => a.id === activeArtId);
    if (art) { try { await exportArt(art.snapshot, art.title, button.dataset.format as 'png' | 'svg'); } catch { toast('画像を保存できませんでした。もう一度お試しください。'); } }
  } else if (action === 'next-study') {
    const a = store.artworks.find(a => a.id === activeArtId);
    if (a?.studyId === 'free') {
      const id = `free-${crypto.randomUUID()}`;
      store.sessions[id] = newSession('free', id); store.active = id;
      resetTools(); closeSheet(); save(); navigate('play');
    } else startStudy(a?.studyId === '01' ? '02' : a?.studyId === '02' ? '03' : 'free');
  } else if (action === 'resume-art') {
    const art = store.artworks.find(a => a.id === activeArtId);
    if (!art) return;
    const id = `art-${crypto.randomUUID()}`;
    store.sessions[id] = { ...newSession('free', id), ...snapshot(art.snapshot), moves: 0 };
    store.active = id; resetTools(); closeSheet(); save(); navigate('play'); toast('元の一枚を残して、自由制作をはじめました。');
  }
}

app.addEventListener('click', event => { void onClick(event); });
dialogRoot.addEventListener('click', event => { void onClick(event); });
app.addEventListener('pointerdown', event => { if ((event.target as Element).closest('#board')) { pointerStart = { x: event.clientX, y: event.clientY }; ignoreClick = false; } });
app.addEventListener('pointerup', event => { if (pointerStart) { ignoreClick = distance(pointerStart, { x: event.clientX, y: event.clientY }) > 16; pointerStart = null; } });
app.addEventListener('pointercancel', () => { pointerStart = null; ignoreClick = true; });
app.addEventListener('keydown', event => {
  const target = event.target as Element;
  if (target.matches('[role="tab"]') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const tabs = [...app.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const at = tabs.indexOf(target as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (at + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus(); tabs[next].click();
  }
  if ((event.key === 'Enter' || event.key === ' ') && target.matches('#board [role="button"]')) { event.preventDefault(); target.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })); }
  if (screen === 'play' && !sheet && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault(); const s = current(); store.sessions[s.id] = event.shiftKey ? redo(s) : undo(s); draft = []; selectedEdge = null; save(); render();
  }
});
dialogRoot.addEventListener('submit', event => {
  if (!(event.target instanceof HTMLFormElement) || event.target.dataset.form !== 'finish') return;
  event.preventDefault();
  const s = current(), title = String(new FormData(event.target).get('title') ?? '').trim().slice(0, 24) || getStudy(s.studyId).title;
  const id = s.galleryId ?? crypto.randomUUID();
  const art: Artwork = { id, title, date: new Date().toISOString(), studyId: s.studyId, snapshot: snapshot(s) };
  store.artworks = [...store.artworks.filter(a => a.id !== id), art]; s.galleryId = id;
  if (!save()) return;
  activeArtId = id; feedback(true); openSheet('saved');
});
window.addEventListener('popstate', () => { closeSheet(); screen = location.hash === '#play' ? 'play' : location.hash === '#gallery' ? 'gallery' : 'home'; resetTools(); render(); });
window.addEventListener('pagehide', () => { if (store.active) save(); });
render();
if (storageWarning) toast('保存データを読み取れませんでした。元のデータは復旧用に保管しています。', 6500);
if (import.meta.env.PROD && 'serviceWorker' in navigator) window.addEventListener('load', () => { void navigator.serviceWorker.register('./sw.js').catch(() => { /* Online play remains available. */ }); });
