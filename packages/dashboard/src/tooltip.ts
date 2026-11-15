/**
 * One tooltip for the whole page. Any element with `data-tip="…"` shows it on hover (mouse only) and on
 * keyboard focus. It is a single fixed-position layer, so the scrolling side column cannot clip it.
 *
 * Motion: opacity and a small scale from the side nearest the trigger, 150 ms; 350 ms before the first tip
 * appears and none when moving from one tip to the next; under reduced motion it only fades (see styles.css).
 */
const SHOW_DELAY_MS = 350;
/** Moving to another tip within this time of the last one hiding skips the delay. */
const WARM_MS = 400;
const GAP = 8;

let tip: HTMLDivElement | null = null;
let current: Element | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let hiddenAt = 0;

function layer(): HTMLDivElement {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'tip';
    tip.id = 'tip';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
  }
  return tip;
}

function place(target: Element): void {
  const t = layer();
  const r = target.getBoundingClientRect();
  const w = t.offsetWidth;
  const h = t.offsetHeight;
  const above = r.top - h - GAP >= 4;
  const top = above ? r.top - h - GAP : Math.min(window.innerHeight - h - 4, r.bottom + GAP);
  const centre = r.left + r.width / 2;
  const left = Math.max(6, Math.min(window.innerWidth - w - 6, centre - w / 2));
  t.style.left = `${Math.round(left)}px`;
  t.style.top = `${Math.round(top)}px`;
  // Grow from the edge that faces the trigger.
  t.style.transformOrigin = `${Math.round(centre - left)}px ${above ? '100%' : '0%'}`;
}

function show(target: Element): void {
  const text = target.getAttribute('data-tip');
  if (!text) return;
  const t = layer();
  current = target;
  t.textContent = text;
  place(target);
  t.classList.add('show');
  target.setAttribute('aria-describedby', 'tip');
}

function hide(): void {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!current) return;
  current.removeAttribute('aria-describedby');
  current = null;
  hiddenAt = performance.now();
  tip?.classList.remove('show');
}

function want(target: Element, immediate: boolean): void {
  if (target === current) return;
  const warm = current !== null || performance.now() - hiddenAt < WARM_MS;
  hide();
  if (immediate || warm) show(target);
  else timer = setTimeout(() => { timer = null; show(target); }, SHOW_DELAY_MS);
}

const tipOf = (e: Event): Element | null => (e.target instanceof Element ? e.target.closest('[data-tip]') : null);

/** Install the page's tooltip. Call once. */
export function installTooltips(): void {
  // Hover tips only where the device can hover: on touch, a tap fires mouseover too and the tip would stick.
  const canHover = window.matchMedia('(hover: hover)');
  document.addEventListener('mouseover', (e) => {
    if (!canHover.matches) return;
    const el = tipOf(e);
    if (el) want(el, false);
    else hide();
  });
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('focusin', (e) => {
    const el = tipOf(e);
    if (el && el.matches(':focus-visible, :has(:focus-visible)')) want(el, true);
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  document.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);
}
