/**
 * Helpers for 3-tier liquid glass surfaces (`glass`, `glass-card`, `glass-thin`).
 * CSS `@supports` and `prefers-reduced-transparency` handle automatic solid fallbacks.
 */

export function glassClass(tier = 'card') {
  if (tier === 'float' || tier === 1) return 'glass';
  if (tier === 'thin' || tier === 3) return 'glass-thin';
  return 'glass-card';
}

export function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
