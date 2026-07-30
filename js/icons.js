// js/icons.js — minimal inline line icons (stroke, currentColor). No dependencies.
// Usage: icon('trophy') → an <svg> string; applyIcons(root) fills <span data-ico="…">.
const P = {
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4zM7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  home: '<path d="M4 11l8-7 8 7M6 10v10h12V10"/>',
  play: '<path d="M7 5l11 7-11 7z"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  heart: '<path d="M12 20s-7-4.6-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.4-7 10-7 10z"/>',
  chevronLeft: '<path d="M15 6l-6 6 6 6"/>',
  chevronRight: '<path d="M9 6l6 6-6 6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 1 4 10.5c-.7.7-1 1.5-1 2.5H9c0-1-.3-1.8-1-2.5A6 6 0 0 1 12 3z"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
};

export function icon(name) {
  const p = P[name];
  if (!p) return '';
  return '<svg class="ico__svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
}

// Fill every <span data-ico="name"> under root with its icon SVG.
export function applyIcons(root = document) {
  for (const el of root.querySelectorAll('[data-ico]')) el.innerHTML = icon(el.dataset.ico);
}
