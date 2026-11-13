/**
 * Safely decide whether an already persisted session can be rendered.
 * Never infer blocks from an unsaved Composer draft or silently generate one.
 * Used for a direct URL, browser refresh and resume from the preparation screen.
 */
export function hasPlayableSessionBlocks(workout) {
  if (!workout?.sessionId) return false;
  const raw = Array.isArray(workout.rawBlocks) ? workout.rawBlocks : [];
  if (raw.some((block) =>
    Boolean(block?.block_key ?? block?.blockKey) &&
    Array.isArray(block?.exercises) && block.exercises.length > 0
  )) return true;

  const blocks = workout?.blocks ?? {};
  const hasBlocks = Array.isArray(blocks)
    ? blocks.length > 0
    : typeof blocks === 'object' && blocks !== null && Object.keys(blocks).length > 0;
  return hasBlocks && Array.isArray(workout?.exercises) && workout.exercises.length > 0;
}

export function playerSessionNeedsReload(workout, requestedSessionId) {
  const target = String(requestedSessionId ?? '').trim();
  if (!target) return false;
  return workout?.sessionId !== target || !hasPlayableSessionBlocks(workout);
}
