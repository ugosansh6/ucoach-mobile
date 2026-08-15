import { supabase } from '../lib/supabase';

const ATHLETIC_DIMENSIONS = [
  'strength',
  'cardio_endurance',
  'bodyweight',
  'explosiveness',
  'mobility',
];

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

function normalizeStartingProfile(startingProfile) {
  const rawStrengths = Array.isArray(startingProfile?.strengths)
    ? startingProfile.strengths
    : [];

  const rawWeaknesses = Array.isArray(startingProfile?.weaknesses)
    ? startingProfile.weaknesses
    : [];

  const strengths = rawStrengths
    .filter((item) => ATHLETIC_DIMENSIONS.includes(item))
    .slice(0, 2);

  const weaknesses = rawWeaknesses
    .filter(
      (item) =>
        ATHLETIC_DIMENSIONS.includes(item) &&
        !strengths.includes(item)
    )
    .slice(0, 2);

  const unsure = Boolean(startingProfile?.unsure);

  const effectiveStrengths = unsure ? [] : strengths;
  const effectiveWeaknesses = unsure ? [] : weaknesses;

  const scores = Object.fromEntries(
    ATHLETIC_DIMENSIONS.map((dimension) => [dimension, 3])
  );

  effectiveStrengths.forEach((dimension) => {
    scores[dimension] = 4;
  });

  effectiveWeaknesses.forEach((dimension) => {
    scores[dimension] = 2;
  });

  return {
    version: 1,
    source: 'onboarding_self_assessment',
    unsure,
    strengths: effectiveStrengths,
    weaknesses: effectiveWeaknesses,
    scores,
  };
}

export async function saveOnboardingProfile({
  level,
  weeklyTarget,
  precautions,
  startingProfile,
}) {
  const user = await getAuthenticatedUser();

  const firstname =
    user.user_metadata?.firstname?.trim() || null;

  const normalizedWeeklyTarget =
    weeklyTarget !== null && weeklyTarget !== undefined
      ? Number(weeklyTarget)
      : null;

  const normalizedPrecautions =
    normalizePrecautions(precautions);

  const normalizedStartingProfile =
    normalizeStartingProfile(startingProfile);

  const payload = {
    id: user.id,
    firstname,
    experience: level,
    weekly_session_target: normalizedWeeklyTarget,
    default_injured_zones: normalizedPrecautions,
    athletic_starting_profile: normalizedStartingProfile,

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
      firstname: firstname?.trim() || null,
      lastname: lastname?.trim() || null,
      birthdate: birthdate || null,
      height:
        height !== null && height !== undefined
          ? Number(height)
          : null,
      weight:
        weight !== null && weight !== undefined
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

export async function updateWeeklySessionTarget(weeklyTarget) {
  const user = await getAuthenticatedUser();
  const normalizedWeeklyTarget = Number(weeklyTarget);

  if (
    !Number.isInteger(normalizedWeeklyTarget) ||
    normalizedWeeklyTarget < 2 ||
    normalizedWeeklyTarget > 6
  ) {
    throw new Error(
      'Le rythme hebdomadaire doit être compris entre 2 et 6 séances.'
    );
  }

  const { data, error } = await supabase
    .from('profiles')
    .update({
      weekly_session_target: normalizedWeeklyTarget,
    })
    .eq('id', user.id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}
