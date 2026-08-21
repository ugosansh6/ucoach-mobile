import { supabase } from '../lib/supabase';

const PERIOD_DAYS = {
  '4w': 28,
  '3m': 90,
  '1y': 365,
};

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

export async function getProgressionDataContract(period = '4w', anchorDate = new Date()) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user?.id) {
    throw new Error('Utilisateur non authentifié.');
  }

  const periodDays = PERIOD_DAYS[period] ?? PERIOD_DAYS['4w'];

  const { data, error } = await supabase.rpc('progression_data_contract_v1', {
    p_user_id: user.id,
    p_period_days: periodDays,
    p_anchor_date: getLocalDateKey(anchorDate),
  });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? {
    version: 'w1-progression-data-contract-v1',
    period_days: periodDays,
    profile: {},
    maturity: {},
    overall: {},
    activity: {},
    movement_capabilities: [],
    protocol_capabilities: [],
    athlete_profile: {},
    athletic_evidence: [],
    records: {},
    coach_signals: [],
    decision_feed: {},
    authority: {},
    semantics: {},
  };
}
