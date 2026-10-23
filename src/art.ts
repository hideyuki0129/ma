import { edgePath, facePath, getFaces } from './geometry';
import { INKS, type Snapshot } from './model';

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function drawingMarkup(s: Snapshot): string {
  const faces = getFaces(s.edges);
  return faces.map(f => `<path d="${facePath(f)}" fill="${s.paints[f.key] ? INKS[s.paints[f.key]].hex : '#fbf9f3'}" fill-rule="evenodd"/>`).join('') + s.edges.map(e => `<path d="${edgePath(e)}" fill="none" stroke="#2b302d" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
}

export function artSvg(s: Snapshot, title = '間 — MA', framed = false): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="${framed ? '1230' : '1080'}" viewBox="0 0 360 ${framed ? '410' : '360'}" role="img" aria-label="${escapeHtml(title)}"><title>${escapeHtml(title)}</title><rect width="360" height="${framed ? '410' : '360'}" fill="#fbf9f3"/>${drawingMarkup(s)}${framed ? `<path d="M28 370H332" stroke="#ddd8ce" stroke-width=".5"/><text x="28" y="391" font-family="serif" font-size="10" fill="#484c43">${escapeHtml(title.slice(0, 24))}</text><text x="332" y="391" text-anchor="end" font-family="serif" font-size="8" letter-spacing="2" fill="#7d8177">MA</text>` : ''}</svg>`;
}

export async function exportArt(s: Snapshot, title: string, format: 'png' | 'svg'): Promise<void> {
  const svg = artSvg(s, title, true);
  let blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  if (format === 'png') {
    const image = new Image(), src = URL.createObjectURL(blob);
    try {
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('画像をつくれませんでした。')); image.src = src; });
      const canvas = document.createElement('canvas');
      canvas.width = 1080; canvas.height = 1230;
      canvas.getContext('2d')!.drawImage(image, 0, 0, 1080, 1230);
      blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('画像をつくれませんでした。')), 'image/png'));
    } finally { URL.revokeObjectURL(src); }
  }
  const filename = `ma-${title.replace(/[/\\:*?"<>|]/g, '').slice(0, 40) || 'artwork'}.${format}`;
  const file = new File([blob], filename, { type: blob.type });
  // The native share sheet on a phone makes "Save image" available without a new tab.
  if (navigator.canShare?.({ files: [file] }) && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
    try { await navigator.share({ files: [file], title }); return; }
    catch (error) { if ((error as Error).name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
