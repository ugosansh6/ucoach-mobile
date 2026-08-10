/*
 * Historique des séances utilisateur.
 *
 * Ce service contiendra plus tard :
 * - liste des séances terminées
 * - dernière séance
 * - détail d'une séance
 * - séances d'une semaine / d'un mois
 *
 * Les appels Supabase seront ajoutés lors du branchement backend.
 */

export async function getWorkoutHistory() {
  throw new Error('getWorkoutHistory not implemented');
}

export async function getLastWorkout() {
  throw new Error('getLastWorkout not implemented');
}

export async function getWorkoutById(sessionId) {
  throw new Error(
    `getWorkoutById not implemented: ${sessionId}`
  );
}

export async function getWorkoutsByDateRange(
  startDate,
  endDate
) {
  throw new Error(
    `getWorkoutsByDateRange not implemented: ${startDate} - ${endDate}`
  );
}