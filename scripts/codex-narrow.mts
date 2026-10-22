// Narrow display check of `npm run a11y -- --narrow` (docs/accessibilite.md, « Affichage étroit et zoom ») : each
// screen rendered at 320 CSS px wide (WCAG 1.4.10, reflow: 1 280 × 1 024 px at 400 %) and at 1 280 px with a 200 % zoom
// (WCAG 1.4.4, resize text: 640 × 400 CSS px at two device pixels per CSS px), beside the desktop size of the other
// checks (1 440 × 900) as the reference. What is measured, in the page itself (measureLayout):
//
//   page      how far the page is wider than the window, in CSS px (html and body hide their overflow: whatever lies
//             beyond the window's right edge cannot be reached at all, there is no scroll bar to bring it in);
//   outside   texts and controls beyond the window's edge, out of reach for that reason;
//   masked    texts and controls cut by a block that hides its overflow (overflow: hidden or clip), out of reach;
//   ellipsis  texts cut by an ellipsis (text-overflow: ellipsis) whose end is not shown;
//   scroll    blocks that scroll sideways (overflow-x: auto or scroll, content wider than the block): their content can
//             be reached, but in two dimensions (WCAG 1.4.10 admits it for tables, not for running text);
//   overlap   two texts or controls drawn over one another (visible parts, neither inside the other).
//
// A text is a node of the element's own text (its box, not the element's); a control is a button, link, field, image or
// icon. Hidden elements (display, visibility, size 0, read by screen readers only) are left out. The counts of a screen
// at desktop size are part of its design (ellipses of long titles, badges over icons): what the narrow sizes add is the
// difference.

export type Size = { key: 'bureau' | '320' | 'zoom200'; label: string; width: number; height: number; scale: number };

export const SIZES: Size[] = [
  { key: 'bureau', label: '1 440 px (référence)', width: 1440, height: 900, scale: 1 },
  { key: '320', label: '320 px', width: 320, height: 256, scale: 1 },
  { key: 'zoom200', label: '1 280 px à 200 %', width: 640, height: 400, scale: 2 },
];

export type Sample = { what: string; text: string; px?: number };
export type Layout = {
  page: number;
  /** The outermost elements wider than the window (first eight). */
  wide: Sample[];
  outside: Sample[];
  masked: Sample[];
  ellipsis: Sample[];
  scroll: Sample[];
  overlap: Sample[];
};
export const KINDS = ['outside', 'masked', 'ellipsis', 'scroll', 'overlap'] as const;
export const KIND_LABEL: Record<(typeof KINDS)[number], string> = {
  outside: 'hors fenêtre',
  masked: 'masqués',
  ellipsis: 'tronqués',
  scroll: 'blocs à défilement horizontal',
  overlap: 'superpositions',
};

/**
 * Runs in the page (page.evaluate): the layout findings of the whole page, or of the elements inside `scope` (a dialog).
 * Self-contained: no closure over this module.
 */
export function measureLayout(scope: string | null): Layout {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const root: Element = (scope && document.querySelector(scope)) || document.body;
  type R = { l: number; t: number; r: number; b: number };
  const rect = (d: DOMRect): R => ({ l: d.left, t: d.top, r: d.right, b: d.bottom });
  const inter = (a: R, b: R): R => ({ l: Math.max(a.l, b.l), t: Math.max(a.t, b.t), r: Math.min(a.r, b.r), b: Math.min(a.b, b.b) });
  const area = (a: R) => Math.max(0, a.r - a.l) * Math.max(0, a.b - a.t);
  const short = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 50);
  const what = (el: Element) => {
    const cls = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).map((c) => c.replace(/_[A-Za-z0-9]{4,}$|__.*$/, '')).slice(0, 2).join('.') : '';
    return el.tagName.toLowerCase() + (cls ? `.${cls}` : '') + (el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : '');
  };
  const label = (el: Element) => short(el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.getAttribute('title') || el.getAttribute('alt') || el.getAttribute('placeholder') || '');
  const hidden = (el: Element) => {
    for (let e: Element | null = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return true;
      if (s.clipPath === 'inset(50%)' || (e.classList.contains('sr-only'))) return true;
    }
    return false;
  };

  // A dialog: how far its box goes beyond the window's edges (the backdrop does not scroll).
  const sb = scope ? root.getBoundingClientRect() : null;
  const page = sb
    ? Math.max(0, Math.round(Math.max(sb.right - W, -sb.left, sb.bottom - H, -sb.top)))
    : Math.max(0, Math.round(Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - W));
  // The outermost elements wider than the window: what makes the page overflow.
  const wide: Sample[] = [];
  if (page > 0 && !scope) {
    for (const el of root.querySelectorAll('*')) {
      const d = el.getBoundingClientRect();
      if (d.right <= W + 1 || d.width < 1) continue;
      const p = el.parentElement?.getBoundingClientRect();
      if (p && p.right > W + 1) continue;
      wide.push({ what: what(el), text: short((el as HTMLElement).innerText ?? '').slice(0, 30), px: Math.round(d.right - W) });
    }
  }

  // Items: own text nodes (their box) and controls (the element's box).
  type Item = { el: Element; box: R; text: string; own: boolean };
  const items: Item[] = [];
  const CONTROL = 'button, a[href], input:not([type=hidden]), select, textarea, img, svg, [role=button], [role=tab], [role=link]';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const byEl = new Map<Element, R>();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent?.trim()) continue;
    const el = n.parentElement;
    if (!el || el.closest('script, style, noscript, template, title')) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const d = range.getBoundingClientRect();
    if (d.width < 1 || d.height < 1) continue;
    const prev = byEl.get(el);
    const r = rect(d);
    byEl.set(el, prev ? { l: Math.min(prev.l, r.l), t: Math.min(prev.t, r.t), r: Math.max(prev.r, r.r), b: Math.max(prev.b, r.b) } : r);
  }
  for (const [el, box] of byEl) items.push({ el, box, text: short(el.textContent ?? ''), own: true });
  for (const el of root.querySelectorAll(CONTROL)) {
    if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
    if (el.tagName.toLowerCase() === 'svg' && el.parentElement?.closest('svg')) continue;
    const d = el.getBoundingClientRect();
    if (d.width < 1 || d.height < 1) continue;
    if (byEl.has(el)) continue;
    items.push({ el, box: rect(d), text: label(el), own: false });
  }

  const outside: Sample[] = [];
  const masked: Sample[] = [];
  const ellipsis: Sample[] = [];
  const scroll: Sample[] = [];
  const overlap: Sample[] = [];
  const visible: (Item & { vis: R })[] = [];
  const view: R = { l: 0, t: 0, r: W, b: H };
  const seenScroll = new Set<Element>();

  for (const it of items) {
    if (hidden(it.el)) continue;
    let vis = it.box;
    let cutBy: 'masked' | 'scroll' | null = null;
    // Walk up the blocks that clip their content (a text's own element first; html and body excepted: what they cut is
    // beyond the window, counted below).
    for (let a = it.own ? it.el : it.el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
      const ab = rect(a.getBoundingClientRect());
      const before = vis;
      vis = inter(vis, ab);
      const cutX = before.l < ab.l - 1 || before.r > ab.r + 1;
      const cutY = before.t < ab.t - 1 || before.b > ab.b + 1;
      const scrollX = s.overflowX === 'auto' || s.overflowX === 'scroll';
      const scrollY = s.overflowY === 'auto' || s.overflowY === 'scroll';
      if ((cutX && !scrollX) || (cutY && !scrollY)) cutBy ??= 'masked';
      else if (cutX && scrollX) cutBy ??= 'scroll';
    }
    const ownStyle = getComputedStyle(it.el);
    const ell = ownStyle.textOverflow === 'ellipsis' && (it.el as HTMLElement).scrollWidth > (it.el as HTMLElement).clientWidth + 1;
    if (ell) ellipsis.push({ what: what(it.el), text: it.text });
    else if (cutBy === 'masked') {
      // An ancestor with an ellipsis cuts its own text: same finding.
      const anc = it.el.parentElement;
      const ancEll = anc && getComputedStyle(anc).textOverflow === 'ellipsis' && (anc as HTMLElement).scrollWidth > (anc as HTMLElement).clientWidth + 1;
      if (ancEll) ellipsis.push({ what: what(anc), text: it.text });
      else masked.push({ what: what(it.el), text: it.text });
    }
    // What is left of it beyond the window: out of reach (html and body hide their overflow; a dialog is fixed).
    if (!ell && cutBy !== 'masked' && area(vis) > 0 && (vis.r > W + 1 || vis.l < -1 || vis.b > H + 1 || vis.t < -1)) {
      outside.push({ what: what(it.el), text: it.text, px: Math.round(Math.max(vis.r - W, -vis.l, vis.b - H, -vis.t)) });
    }
    vis = inter(vis, view);
    if (area(vis) >= 4) visible.push({ ...it, vis });
  }

  // Blocks that scroll sideways.
  for (const el of root.querySelectorAll('*')) {
    const s = getComputedStyle(el);
    if (s.overflowX !== 'auto' && s.overflowX !== 'scroll') continue;
    const h = el as HTMLElement;
    if (h.scrollWidth > h.clientWidth + 1 && h.clientWidth > 0 && !hidden(el) && !seenScroll.has(el)) {
      seenScroll.add(el);
      scroll.push({ what: what(el), text: short(h.innerText).slice(0, 40), px: h.scrollWidth - h.clientWidth });
    }
  }

  // Overlaps between visible parts, neither element inside the other.
  for (let i = 0; i < visible.length; i++) {
    const a = visible[i];
    for (let j = i + 1; j < visible.length; j++) {
      const b = visible[j];
      if (a.vis.r <= b.vis.l || b.vis.r <= a.vis.l || a.vis.b <= b.vis.t || b.vis.b <= a.vis.t) continue;
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const ov = area(inter(a.vis, b.vis));
      if (ov < 9 || ov < 0.15 * Math.min(area(a.vis), area(b.vis))) continue;
      overlap.push({ what: `${what(a.el)} × ${what(b.el)}`, text: `${a.text.slice(0, 24)} × ${b.text.slice(0, 24)}` });
    }
  }
  return { page, wide: wide.slice(0, 8), outside, masked, ellipsis, scroll, overlap };
}
