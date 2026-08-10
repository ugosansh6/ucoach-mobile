/*
 * Service exercices UGEROD
 *
 * Ce service centralisera toutes les lectures
 * liées aux exercices.
 *
 * Les appels Supabase seront ajoutés
 * pendant le branchement backend.
 */

export const TRACKING_TYPES = {
  BODYWEIGHT: 'bodyweight',
  LOAD: 'load',
  REPS: 'reps',
  TIME: 'time',
  DISTANCE: 'distance',
};

/*
 * Exemple de structure attendue pour un exercice :
 *
 * {
 *   id: 'goblet-squat',
 *   name: 'GOBLET SQUAT',
 *   region: 'BAS DU CORPS',
 *   equipment: ['Kettlebell', 'Haltères'],
 *   trackingType: 'load',
 * }
 */

export async function getExercises() {
  throw new Error(
    'getExercises not implemented'
  );
}

export async function getExerciseById(
  exerciseId
) {
  throw new Error(
    `getExerciseById not implemented: ${exerciseId}`
  );
}