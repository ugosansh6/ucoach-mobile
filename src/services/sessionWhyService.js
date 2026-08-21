import { supabase } from '../lib/supabase';

export async function getSessionWhy(sessionId) {
  if (!sessionId) {
    return {
      status: 'NO_SESSION',
      reasons: [],
    };
  }

  const { data, error } = await supabase.rpc(
    'w3_session_why_v1',
    {
      p_session_id: sessionId,
    }
  );

  if (error) {
    throw new Error(
      error?.message ??
        'Impossible de charger les raisons de cette séance.'
    );
  }

  const reasons = Array.isArray(data?.reasons)
    ? data.reasons.filter(
        (reason) =>
          typeof reason?.text === 'string' &&
          reason.text.trim().length > 0
      )
    : [];

  return {
    ...(data ?? {}),
    reasons,
  };
}
