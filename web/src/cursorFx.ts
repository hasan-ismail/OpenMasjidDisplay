/**
 * Apple-style liquid-glass pointer refraction: light catching the glass as the
 * cursor moves over it. Sets --mx/--my (cursor position within the hovered pane)
 * and glass.css renders a small specular highlight there. One delegated,
 * rAF-throttled pointermove listener; resets the previous pane on leave; off
 * under prefers-reduced-motion.
 */
const GLASS_SELECTOR = '.glass, .glass-raised';

let installed = false;

export function installCursorFx(): void {
  if (typeof window === 'undefined' || installed) return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  installed = true;

  let last: HTMLElement | null = null;
  let target: HTMLElement | null = null;
  let x = 0;
  let y = 0;
  let scheduled = false;

  function flush() {
    scheduled = false;
    if (!target) return;
    const r = target.getBoundingClientRect();
    target.style.setProperty('--mx', `${x - r.left}px`);
    target.style.setProperty('--my', `${y - r.top}px`);
  }

  window.addEventListener(
    'pointermove',
    (e) => {
      const el = (e.target as Element | null)?.closest?.(GLASS_SELECTOR) as HTMLElement | null;
      if (el !== last) {
        if (last) {
          last.style.removeProperty('--mx');
          last.style.removeProperty('--my');
        }
        last = el;
      }
      if (!el) return;
      target = el;
      x = e.clientX;
      y = e.clientY;
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(flush);
      }
    },
    { passive: true },
  );
}
