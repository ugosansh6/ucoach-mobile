// Read the existing C4 contracts for the formats the Composer RPC exposes.
// This is a manual-selection ceiling, not a recommended exercise count/dose.
export function composerWodSelectionLimit(contracts) {
  if (!Array.isArray(contracts) || !contracts.length) return 3;
  const valid = contracts.every((c) => c?.found === true
    && Number.isInteger(c.min_exercises) && c.min_exercises >= 1
    && Number.isInteger(c.max_exercises) && c.max_exercises >= c.min_exercises
    && c.max_exercises <= 8); // Existing Composer compiler's structural ceiling.
  return valid ? Math.max(...contracts.map((c) => c.max_exercises)) : 3;
}

export function toggleComposerExercise(selected, id, limit) {
  if (selected.includes(id)) return selected.filter((value) => value !== id);
  if (selected.length < limit) return [...selected, id];
  // Older saved choices can exceed the current/fallback ceiling. Replacing
  // one movement must preserve every other explicit selection, in order.
  return [...selected.slice(0, -1), id];
}
