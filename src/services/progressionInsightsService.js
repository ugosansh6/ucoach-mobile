import { supabase } from '../lib/supabase';

const PERIOD_DAYS = {
  '4w': 28,
  '3m': 90,
  '1y': 365,
};

export async function getProgressionInsights(period = '4w') {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error('Utilisateur non authentifié.');
  }

  const periodDays = PERIOD_DAYS[period] ?? PERIOD_DAYS['4w'];

  const [profileResult, intelligenceResult, athleteSummaryResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('firstname, experience, weekly_session_target')
      .eq('id', user.id)
      .maybeSingle(),
    supabase.rpc('pi_progression_snapshot', {
      p_user_id: user.id,
      p_period_days: periodDays,
    }),
    supabase.rpc('athlete_profile_summary_v1', {
      p_user_id: user.id,
    }),
  ]);

  const errors = [
    profileResult.error,
    intelligenceResult.error,
    athleteSummaryResult.error,
  ].filter(Boolean);

  if (errors.length > 0) {
    throw errors[0];
  }

  return {
    period,
    periodDays,
    profile: profileResult.data ?? null,
    intelligence: intelligenceResult.data ?? null,
    athleteSummary: athleteSummaryResult.data ?? null,
  };
}
