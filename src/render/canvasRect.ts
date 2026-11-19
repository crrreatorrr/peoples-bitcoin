/**
 * The canvas's page rectangle, read once and kept until the page resizes or scrolls or the
 * canvas changes size. toScreen runs for every nameplate, hitsplat and overhead each frame,
 * between DOM style writes; reading the rectangle there forced a layout every call.
 */
const rects = new Map<HTMLElement, DOMRect>();
let observer: ResizeObserver | null = null;

export function canvasRect(canvas: HTMLElement): DOMRect {
  let rect = rects.get(canvas);
  if (rect) return rect;
  if (rects.size === 0 && !observer) {
    const forget = () => rects.clear();
    window.addEventListener('resize', forget);
    window.addEventListener('scroll', forget, { capture: true, passive: true });
    if (typeof ResizeObserver === 'function') observer = new ResizeObserver(forget);
  }
  rect = canvas.getBoundingClientRect();
  rects.set(canvas, rect);
  observer?.observe(canvas);
  return rect;
}
