import { supabase } from '../lib/supabase';
import { runSupabaseRequestWithAuthRetry } from '../lib/supabaseAuthRetry';
import { reloadWorkoutSession } from './workoutService';

const DEV_TEST_RELOAD = process.env.EXPO_PUBLIC_APP_ENV === 'development';

async function invokePlanB(body, fallbackMessage) {
  const data = await runSupabaseRequestWithAuthRetry(() =>
    supabase.functions.invoke(
      'plan-b-handler',
      { body }
    )
  );

  if (!data?.ok) {
    throw new Error(
      data?.error ?? fallbackMessage
    );
  }

  return data?.result ?? null;
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

  const data = await invokePlanB(
    {
      mode: 'SKILL',
      session_id: sessionId,
      action,
    },
    'Impossible de proposer un autre Skill.'
  );

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

  let data;

  try {
    data = await invokePlanB(
      {
        mode: 'WHOLE_SESSION',
        session_id: sessionId,
        allow_test_reset: DEV_TEST_RELOAD,
      },
      'Impossible de proposer une autre séance.'
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error ?? '');

    throw new Error(
      message.includes(
        'SESSION_PLAN_B_NO_MEANINGFUL_ALTERNATIVE_AVAILABLE'
      )
        ? 'UGEROD n’a pas trouvé de deuxième proposition suffisamment différente et cohérente.'
        : message ||
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
