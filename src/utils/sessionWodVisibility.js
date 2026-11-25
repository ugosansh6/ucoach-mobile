/**
 * WOD visibility is not a persisted lifecycle event. Ma semaine compositions
 * are authored by the athlete; automatic Coach sessions keep progressive reveal.
 */
export function isUserComposedSession(workout) {
  return String(workout?.meta?.source ?? '').trim().toLowerCase() === 'w11_composer';
}

export function shouldShowWodContent(workout, { lifecycleReady = false } = {}) {
  return isUserComposedSession(workout) ||
    Boolean(lifecycleReady && (workout?.wodRevealed || workout?.wodRevealedAt));
}
