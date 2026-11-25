import { supabase } from '../lib/supabase';

export async function recordSessionExecutionEvent({
  sessionId,
  eventType,
  payload = {},
  source = 'user_action',
  sessionExerciseId = null,
  blockKey = null,
  occurredAt = null,
  idempotencyKey = null,
}) {
  if (!sessionId || !eventType) {
    return { status: 'SKIPPED' };
  }

  const { data, error } = await supabase.rpc(
    'record_session_execution_event_v1',
    {
      p_session_id: sessionId,
      p_event_type: eventType,
      p_payload: payload ?? {},
      p_source: source,
      p_session_exercise_id:
        sessionExerciseId,
      p_block_key: blockKey,
      p_occurred_at: occurredAt,
      p_idempotency_key: idempotencyKey,
    }
  );

  if (error) {
    throw new Error(error.message);
  }

  return data ?? { status: 'UNKNOWN' };
}

export function recordSessionExecutionEventQuietly(
  args
) {
  recordSessionExecutionEvent(args).catch(
    (error) => {
      console.warn(
        'UGEROD execution trace',
        error
      );
    }
  );
}

export async function getObservationQuestionNeed(
  sessionId,
  questionKey
) {
  if (!sessionId || !questionKey) {
    return {
      should_ask: false,
      reason: 'MISSING_INPUT',
    };
  }

  const { data, error } = await supabase.rpc(
    'w2_session_question_need_v1',
    {
      p_session_id: sessionId,
      p_question_key: questionKey,
    }
  );

  if (error) {
    throw new Error(error.message);
  }

  return data ?? {
    should_ask: false,
    reason: 'NO_RESPONSE',
  };
}

export async function submitSkillTechnicalFeedback({
  sessionExerciseId,
  feedback,
}) {
  if (!sessionExerciseId || !feedback) {
    throw new Error(
      'Feedback Skill incomplet.'
    );
  }

  const { data, error } = await supabase.rpc(
    'w2_submit_skill_technical_feedback_v1',
    {
      p_session_exercise_id:
        sessionExerciseId,
      p_feedback: feedback,
    }
  );

  if (error) {
    throw new Error(error.message);
  }

  return data ?? { status: 'UNKNOWN' };
}

export async function getSessionExecutionObservation(
  sessionId
) {
  if (!sessionId) {
    return null;
  }

  const { data, error } = await supabase.rpc(
    'w2_session_execution_observation_v1',
    { p_session_id: sessionId }
  );

  if (error) {
    throw new Error(error.message);
  }

  return data ?? null;
}
