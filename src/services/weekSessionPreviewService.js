import { supabase } from '../lib/supabase';
import {
  getAuthenticatedUserWithRetry,
  runSupabaseRequestWithAuthRetry,
} from '../lib/supabaseAuthRetry';

export async function getWeekSessionExercisePreviews(sessionIds = []) {
  const ids = [...new Set((sessionIds ?? []).filter(Boolean))];
  if (ids.length === 0) return {};

  await getAuthenticatedUserWithRetry();

  const rows = await runSupabaseRequestWithAuthRetry(() =>
    supabase
      .from('workout_session_exercises')
      .select('session_id, exercise_name, block_key, position')
      .in('session_id', ids)
      .order('block_key', { ascending: true })
      .order('position', { ascending: true })
  );

  const previews = {};
  for (const row of rows ?? []) {
    const sessionId = row?.session_id ?? null;
    const name = String(row?.exercise_name ?? '').trim();
    if (!sessionId || !name) continue;

    if (!previews[sessionId]) previews[sessionId] = [];
    if (previews[sessionId].some((item) => item.name === name)) continue;
    if (previews[sessionId].length >= 8) continue;

    previews[sessionId].push({
      name,
      blockKey: row?.block_key ?? null,
      position: row?.position == null ? null : Number(row.position),
    });
  }

  return previews;
}
