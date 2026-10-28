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
