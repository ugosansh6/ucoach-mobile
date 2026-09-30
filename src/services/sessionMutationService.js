// Shared mutation contract for every UGEROD session runtime.
// HOME, BOX, GYM and OUTDOOR keep their domain-specific renderers, but user
// mutations go through this single service seam so performance/guard changes
// can be applied once.

export {
  changeWorkoutFormat,
  getWorkoutFormatOptions,
  getWorkoutSessionLifecycle,
  getWorkoutSwapAvailabilityForExercise,
  markWorkoutSessionStarted,
  markWorkoutWodRevealed,
  markWorkoutWodStarted,
  reloadWorkoutSession,
  swapWorkoutExercise,
} from './workoutService';

export {
  adaptSessionExercise,
} from './sessionAdaptationService';

export {
  changeWholeWorkoutPlan,
  changeWorkoutSkillPlan,
} from './skillPlanService';

export const SESSION_MUTATION_CONTRACT_VERSION =
  'session-mutation-contract-v1';

export function normalizeSessionEnvironment(value) {
  const key = String(value ?? '')
    .trim()
    .toUpperCase();

  if (['HOME', 'HOUSE', 'MAISON'].includes(key)) return 'HOME';
  if (['BOX', 'CROSSFIT', 'CROSSFIT_BOX'].includes(key)) return 'BOX';
  if (['GYM', 'SALLE', 'SALLE_DE_SPORT', 'GYM_BOX'].includes(key)) return 'GYM';
  if (['OUTDOOR', 'EXTERIEUR', 'EXTÉRIEUR'].includes(key)) return 'OUTDOOR';
  return 'UNKNOWN';
}
