import { supabase } from '../lib/supabase';
import {
  getAuthenticatedUserWithRetry,
  runSupabaseRequestWithAuthRetry,
} from '../lib/supabaseAuthRetry';

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

async function getAuthenticatedUser() {
  return getAuthenticatedUserWithRetry();
}

export async function getProgressionDataContract(period = '4w', anchorDate = new Date()) {
  const user = await getAuthenticatedUser();
  const periodDays = PERIOD_DAYS[period] ?? PERIOD_DAYS['4w'];

  const data = await runSupabaseRequestWithAuthRetry(() =>
    supabase.rpc('progression_data_contract_v1', {
      p_user_id: user.id,
      p_period_days: periodDays,
      p_anchor_date: getLocalDateKey(anchorDate),
    })
  );

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

export async function getCoachOpportunitySnapshot(anchorDate = new Date()) {
  try {
    const user = await getAuthenticatedUser();
    const data = await runSupabaseRequestWithAuthRetry(() =>
      supabase.rpc('w3_opportunity_engine_v1', {
        p_user_id: user.id,
        p_anchor_date: getLocalDateKey(anchorDate),
      })
    );

    return data ?? null;
  } catch (error) {
    console.warn('Coach opportunity snapshot unavailable:', error?.message ?? error);
    return null;
  }
}

export async function getW4ProgressionIntelligence(anchorDate = new Date()) {
  try {
    const user = await getAuthenticatedUser();
    const data = await runSupabaseRequestWithAuthRetry(() =>
      supabase.rpc('w4_progression_intelligence_v1', {
        p_user_id: user.id,
        p_anchor_date: getLocalDateKey(anchorDate),
      })
    );

    return data ?? null;
  } catch (error) {
    console.warn('W4 progression intelligence unavailable:', error?.message ?? error);
    return null;
  }
}

export async function getSessionLearningSnapshot(sessionId) {
  if (!sessionId) {
    throw new Error('Session manquante pour le débrief Coach.');
  }

  await getAuthenticatedUser();

  const data = await runSupabaseRequestWithAuthRetry(() =>
    supabase.rpc(
      'w2_progression_session_learning_snapshot_v1',
      { p_session_id: sessionId }
    )
  );

  return data ?? {
    version: 'w2-session-learning-snapshot-v1',
    session: {},
    summary: {},
    wod_performance_context: {},
    execution_observation: {},
    observations: [],
    proof_classes: {},
    semantics: {},
  };
}
