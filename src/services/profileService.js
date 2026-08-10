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

function normalizePrecautions(precautions) {
  if (!Array.isArray(precautions)) {
    return [];
  }

  return precautions.filter((item) => {
    if (!item) {
      return false;
    }

    return item.trim().toLowerCase() !== 'aucune';
  });
}

export async function saveOnboardingProfile({
  level,
  weeklyTarget,
  precautions,
}) {
  const user = await getAuthenticatedUser();

  const firstname =
    user.user_metadata?.firstname?.trim() || null;

  const normalizedWeeklyTarget =
    weeklyTarget !== null &&
    weeklyTarget !== undefined
      ? Number(weeklyTarget)
      : null;

  const normalizedPrecautions =
    normalizePrecautions(precautions);

  const payload = {
    id: user.id,
    firstname,
    experience: level,
    weekly_session_target:
      normalizedWeeklyTarget,
    default_injured_zones:
      normalizedPrecautions,

    /*
     * On ne passe à true qu'une fois
     * l'objectif enregistré avec succès.
     */
    onboarding_completed: false,
  };

  const { data, error } = await supabase
    .from('profiles')
    .upsert(payload, {
      onConflict: 'id',
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function markOnboardingCompleted() {
  const user = await getAuthenticatedUser();

  const { data, error } = await supabase
    .from('profiles')
    .update({
      onboarding_completed: true,
    })
    .eq('id', user.id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function getCurrentProfile() {
  const user = await getAuthenticatedUser();

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}
export async function updatePersonalInformation({
  firstname,
  lastname,
  birthdate,
  height,
  weight,
}) {
  const user = await getAuthenticatedUser();

  const { data, error } = await supabase
    .from('profiles')
    .update({
      firstname:
        firstname?.trim() || null,
      lastname:
        lastname?.trim() || null,
      birthdate:
        birthdate || null,
      height:
        height !== null &&
        height !== undefined
          ? Number(height)
          : null,
      weight:
        weight !== null &&
        weight !== undefined
          ? Number(weight)
          : null,
    })
    .eq('id', user.id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}
export async function updateExperienceLevel(level) {
  const user = await getAuthenticatedUser();

  const { data, error } = await supabase
    .from('profiles')
    .update({
      experience: level,
    })
    .eq('id', user.id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}