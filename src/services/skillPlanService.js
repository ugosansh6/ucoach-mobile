import { supabase } from '../lib/supabase';
import { reloadWorkoutSession } from './workoutService';

async function getAuthenticatedUserId() {
  const {
    data: authData,
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    throw authError;
  }

  const userId = authData?.user?.id;

  if (!userId) {
    throw new Error(
      'Tu dois être connecté pour modifier cette séance.'
    );
  }

  return userId;
}

async function reloadPlanBWorkout({
  data,
  preparationSnapshot,
}) {
  const newSessionId = data?.new_session_id;

  if (!newSessionId) {
    throw new Error(
      'La séance alternative est introuvable.'
    );
  }

  const workout = await reloadWorkoutSession({
    sessionId: newSessionId,
    preparationSnapshot,
  });

  return {
    result: data,
    workout,
  };
}

export async function changeWorkoutSkillPlan({
  sessionId,
  action,
  preparationSnapshot = null,
}) {
  if (!sessionId) {
    throw new Error(
      'Impossible de modifier le Skill : séance introuvable.'
    );
  }

  if (
    !['ALTERNATE_SKILL', 'SKIP_SKILL'].includes(
      action
    )
  ) {
    throw new Error(
      'Action Skill non reconnue.'
    );
  }

  const userId =
    await getAuthenticatedUserId();

  const { data, error } = await supabase.rpc(
    'change_workout_skill_plan_v1',
    {
      p_user_id: userId,
      p_session_id: sessionId,
      p_action: action,
    }
  );

  if (error) {
    throw new Error(
      error?.message ??
        'Impossible de proposer un autre Skill.'
    );
  }

  if (data?.status !== 'APPLIED') {
    throw new Error(
      data?.reason ===
      'SKILL_PLAN_B_ONLY_BEFORE_SESSION_START'
        ? 'Le Skill ne peut être remplacé qu’avant le démarrage de la séance.'
        : 'Aucune alternative sûre n’a été trouvée pour cette séance.'
    );
  }

  return reloadPlanBWorkout({
    data,
    preparationSnapshot,
  });
}

export async function changeWholeWorkoutPlan({
  sessionId,
  preparationSnapshot = null,
}) {
  if (!sessionId) {
    throw new Error(
      'Impossible de proposer une autre séance : séance introuvable.'
    );
  }

  const userId =
    await getAuthenticatedUserId();

  const { data, error } = await supabase.rpc(
    'change_workout_session_plan_v1',
    {
      p_user_id: userId,
      p_session_id: sessionId,
    }
  );

  if (error) {
    throw new Error(
      error?.message?.includes(
        'SESSION_PLAN_B_NO_MEANINGFUL_ALTERNATIVE_AVAILABLE'
      )
        ? 'UGEROD n’a pas trouvé de deuxième proposition suffisamment différente et cohérente.'
        : error?.message ??
          'Impossible de proposer une autre séance.'
    );
  }

  if (data?.status !== 'APPLIED') {
    throw new Error(
      data?.reason ===
      'SESSION_PLAN_B_ONLY_BEFORE_SESSION_START'
        ? 'Une autre séance ne peut être proposée qu’avant le démarrage.'
        : 'Aucune autre séance suffisamment différente n’a été trouvée.'
    );
  }

  return reloadPlanBWorkout({
    data,
    preparationSnapshot,
  });
}
