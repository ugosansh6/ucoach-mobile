import { supabase } from '../lib/supabase';

async function getAuthenticatedUser() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  if (!user) {
    throw new Error(
      'Aucun utilisateur connecté. Reconnecte-toi puis recommence.'
    );
  }

  return user;
}

export async function savePrimaryGoal(goalName) {
  if (!goalName) {
    throw new Error(
      'Aucun objectif sélectionné.'
    );
  }

  const user = await getAuthenticatedUser();

  /*
   * 1. On retrouve l'objectif
   * dans le catalogue public.goals.
   */
  const {
    data: goal,
    error: goalError,
  } = await supabase
    .from('goals')
    .select('id, name')
    .eq('name', goalName)
    .maybeSingle();

  if (goalError) {
    throw goalError;
  }

  if (!goal) {
    throw new Error(
      `Objectif introuvable dans Supabase : ${goalName}`
    );
  }

  /*
   * V1 UGEROD :
   * un seul objectif principal.
   *
   * On supprime donc l'ancien objectif
   * éventuel avant d'enregistrer le nouveau.
   */
  const { error: deleteError } = await supabase
    .from('user_goals')
    .delete()
    .eq('user_id', user.id);

  if (deleteError) {
    throw deleteError;
  }

  /*
   * Priority = 1 = objectif principal.
   */
  const {
    data,
    error,
  } = await supabase
    .from('user_goals')
    .insert({
      user_id: user.id,
      goal_id: goal.id,
      priority: 1,
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return {
    ...data,
    goal,
  };
}export async function getCurrentPrimaryGoal() {
  const user = await getAuthenticatedUser();

  const {
    data,
    error,
  } = await supabase
    .from('user_goals')
    .select(`
      priority,
      goal:goals (
        id,
        name,
        description
      )
    `)
    .eq('user_id', user.id)
    .eq('priority', 1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.goal ?? null;
}