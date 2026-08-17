import { supabase } from '../lib/supabase';

async function getAuthenticatedUserId() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw new Error(error.message);
  }

  if (!user?.id) {
    throw new Error('Utilisateur non authentifié.');
  }

  return user.id;
}

export function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function getProgramCoachSnapshot(anchorDate = new Date()) {
  const userId = await getAuthenticatedUserId();

  const { data, error } = await supabase.rpc(
    'program_coach_snapshot_v1',
    {
      p_user_id: userId,
      p_anchor_date: getLocalDateKey(anchorDate),
    }
  );

  if (error) {
    throw new Error(error.message);
  }

  return normalizeProgramCoachSnapshot(data);
}

function normalizePriority(item) {
  return {
    key: item?.key ?? 'quality',
    role: item?.role ?? 'MAINTAIN',
    weight: Number(item?.weight ?? 0),
  };
}

function normalizeProgramCoachSnapshot(data) {
  const source = data ?? {};
  const active = source.active_base_block ?? null;
  const proposed = source.proposed_base_block ?? null;
  const block = active ?? proposed;
  const priorities = Array.isArray(
    block?.priorities ?? source.priority_snapshot?.quality_priorities
  )
    ? (block?.priorities ?? source.priority_snapshot?.quality_priorities).map(
        normalizePriority
      )
    : [];

  return {
    version: source.version ?? null,
    mode: source.mode ?? 'SHADOW',
    isActive: Boolean(active),
    block: block
      ? {
          id: block.id ?? null,
          programKind: block.program_kind ?? 'adaptive_standard',
          phase: block.phase ?? 'CALIBRATE',
          primaryGoal:
            block.primary_goal ??
            source.priority_snapshot?.primary_goal ??
            'General Fitness',
          startedOn: block.started_on ?? null,
          targetEndOn: block.target_end_on ?? null,
          nominalWeeks: Number(block.nominal_weeks ?? 4),
          currentWeekIndex: Number(block.current_week_index ?? 1),
          priorities,
          rationale: block.rationale ?? block.rationale_json ?? {},
        }
      : null,
    recentLoad: {
      pressure: source.recent_load?.load_pressure ?? 'LOW',
      confidence: source.recent_load?.signal_confidence ?? 'LOW',
      sessions7d: Number(source.recent_load?.sessions?.['7d'] ?? 0),
      sessions14d: Number(source.recent_load?.sessions?.['14d'] ?? 0),
      sessions28d: Number(source.recent_load?.sessions?.['28d'] ?? 0),
    },
    startState:
      source.priority_snapshot?.athlete_start_state ??
      proposed?.athlete_state ??
      null,
    raw: source,
  };
}
