import { exerciseSearchMatches } from '../utils/exerciseNames';
import { supabase } from '../lib/supabase';

async function getAuthenticatedUser() {
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

  return user;
}

export async function getPerformanceRecordBook() {
  const user = await getAuthenticatedUser();

  const { data, error } = await supabase.rpc(
    'pr_book_snapshot_v1',
    {
      p_user_id: user.id,
    }
  );

  if (error) {
    throw new Error(error.message);
  }

  return data ?? {
    summary: {},
    current_records: [],
    suggestions_to_confirm: [],
    strength_curve_exercises: [],
  };
}

export async function getStrengthCurve(exerciseId) {
  const user = await getAuthenticatedUser();

  const { data, error } = await supabase.rpc(
    'pr_strength_curve_v1',
    {
      p_user_id: user.id,
      p_exercise_id: exerciseId,
      p_target_reps: [1, 3, 5, 8, 10],
    }
  );

  if (error) {
    throw new Error(error.message);
  }

  return data ?? null;
}

export async function searchRecordExercises(query = '') {
  await getAuthenticatedUser();

  // Catalogue-only search; retain original names and payload for writes.
  const term=String(query??'').trim();
  const rows=[];
  for(let offset=0;;offset+=500){
    const {data,error}=await supabase.from('exercises')
      .select('id, name, display_name, tracking_modes, prescription_type, exercise_family, movement_pattern')
      .order('name',{ascending:true}).order('id',{ascending:true}).range(offset,offset+499);
    if(error)throw new Error(error.message);
    rows.push(...(data??[]));
    if(!data||data.length<500)break;
  }
  return rows.filter(row=>exerciseSearchMatches(row,term) && Array.isArray(row.tracking_modes) && row.tracking_modes.length>0).slice(0,30);
}

export async function getExerciseRecordMetricOptions(exerciseId) {
  await getAuthenticatedUser();

  const { data, error } = await supabase.rpc(
    'get_exercise_pr_metric_options_v1',
    {
      p_exercise_id: exerciseId,
    }
  );

  if (error) {
    throw new Error(error.message);
  }

  const source = data ?? { metrics: [] };

  return {
    ...source,
    metrics: (source.metrics ?? []).map((metric) => ({
      ...metric,
      canonical_unit: metric.canonical_unit ?? metric.unit ?? null,
    })),
  };
}

export async function saveManualExerciseRecord({
  exerciseId,
  metricKey,
  metricValue,
  qualifier = {},
  observedAt = new Date(),
  note = null,
}) {
  await getAuthenticatedUser();

  const { data, error } = await supabase.rpc(
    'upsert_manual_performance_record_v1',
    {
      p_subject_kind: 'exercise',
      p_metric_key: metricKey,
      p_metric_value: Number(metricValue),
      p_exercise_id: exerciseId,
      p_benchmark_key: null,
      p_benchmark_name: null,
      p_qualifier_json: qualifier,
      p_observed_at: observedAt.toISOString(),
      p_note: note || null,
    }
  );

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function saveManualBenchmarkRecord({
  benchmarkName,
  metricKey,
  metricValue,
  qualifier = {},
  observedAt = new Date(),
  note = null,
}) {
  await getAuthenticatedUser();

  const { data, error } = await supabase.rpc(
    'upsert_manual_performance_record_v1',
    {
      p_subject_kind: 'benchmark',
      p_metric_key: metricKey,
      p_metric_value: Number(metricValue),
      p_exercise_id: null,
      p_benchmark_key: null,
      p_benchmark_name: benchmarkName,
      p_qualifier_json: qualifier,
      p_observed_at: observedAt.toISOString(),
      p_note: note || null,
    }
  );

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function confirmPerformanceRecordSuggestion(entryId) {
  await getAuthenticatedUser();

  const { data, error } = await supabase.rpc(
    'confirm_performance_record_entry_v1',
    {
      p_entry_id: entryId,
    }
  );

  if (error) {
    throw new Error(error.message);
  }

  return data;
}
