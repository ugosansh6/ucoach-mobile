/**
 * Checkout copy for the preparation screen.
 * In Composer, the same canGenerate guard that protects the existing
 * required check-in inputs determines whether the session can be launched.
 * Never infer readiness from optional region preferences.
 */
export function preparationPrimaryActionLabel({ hasComposer = false, canGenerate = false } = {}) {
  if (!hasComposer) return 'Voir ma séance';
  return canGenerate ? 'LANCER LA SÉANCE' : 'FINALISER LA SÉANCE';
}
