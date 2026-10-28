/** Item stack counts, OSRS-style: yellow below 100K, white "K" up to 10M, green "M" beyond. */
export function formatQty(n: number): { text: string; className: string } {
  if (n >= 10_000_000) return { text: `${Math.floor(n / 1_000_000)}M`, className: 'qty-m' };
  if (n >= 100_000) return { text: `${Math.floor(n / 1000)}K`, className: 'qty-k' };
  return { text: String(n), className: 'qty-n' };
}

/** A small span showing a stack count. */
export function qtyBadge(n: number): HTMLSpanElement {
  const { text, className } = formatQty(n);
  const badge = document.createElement('span');
  badge.className = `item-qty ${className}`;
  badge.textContent = text;
  return badge;
}

/**
 * OSRS colors a monster's "(level-N)" by how it compares to your combat level:
 * yellow when even, shading to red as it gets stronger and green as it gets weaker.
 */
export function levelTag(level: number, yours: number): { text: string; color: string } {
  const diff = Math.max(-10, Math.min(10, level - yours));
  const fade = Math.round(255 * (1 - Math.abs(diff) / 10));
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  const color = diff >= 0 ? `#ff${hex(fade)}00` : `#${hex(fade)}ff00`;
  return { text: `(level-${level})`, color };
}
