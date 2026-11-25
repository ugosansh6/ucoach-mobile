const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const filePath = path.join(root, 'src', 'services', 'workoutService.js');

const raw = fs.readFileSync(filePath, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
let text = raw.replace(/\r\n/g, '\n');

const oldBlock = `  const { data, error } =
    await supabase.functions.invoke(
      'hyper-api-instance',
      {
        body: {
          session_id: sessionId,
          post_workout_feeling: formAfter,
          global_rpe: rpe,
          notes: notes?.trim() || null,
          exercises: results,
          protocol_outcome:
            protocolOutcome &&
            typeof protocolOutcome === 'object'
              ? protocolOutcome
              : null,
        },
      }
    );

  if (error) {
    let detail = null;

    try {
      detail = await error?.context?.json();
    } catch {
      detail = null;
    }

    const detailMessage =
      detail?.error ??
      detail?.message ??
      error?.message ??
      'Erreur inconnue pendant l’enregistrement.';

    throw new Error(detailMessage);
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data;`;

const newBlock = `  // FC7 is the authoritative completion path. It is SECURITY DEFINER,
  // validates auth.uid() + session ownership, validates the complete payload
  // before the first mutation, and writes the session + exact exercise
  // instances + exercise_logs atomically. This deliberately bypasses the old
  // Edge path that attempted direct table mutations with the authenticated
  // client and now conflicts with the hardened client ACLs.
  const { data, error } = await supabase.rpc(
    'complete_workout_session_v1',
    {
      p_session_id: sessionId,
      p_global_rpe: rpe,
      p_post_workout_feeling: formAfter,
      p_notes: notes?.trim() || null,
      p_exercises: results,
      p_protocol_outcome:
        protocolOutcome &&
        typeof protocolOutcome === 'object'
          ? protocolOutcome
          : null,
    }
  );

  if (error) {
    throw new Error(
      error?.message ??
        'Erreur inconnue pendant l’enregistrement.'
    );
  }

  if (
    data?.status ===
    'ALREADY_COMPLETED_INCONSISTENT'
  ) {
    throw new Error(
      'La séance est marquée terminée mais son historique est incomplet. Une vérification backend est nécessaire.'
    );
  }

  // Derived coach analyses happen after the authoritative transaction.
  // They must never make the raw user completion fail once it is safely saved.
  const analysisCalls = [
    supabase.rpc(
      'run_capability_live_session',
      {
        p_session_id: sessionId,
        p_engine_policy_key:
          'b2.7-live-default',
        p_quality_policy_key:
          'b2.6-adapter-draft-1',
      }
    ),
    supabase.rpc(
      'apply_session_protocol_observation',
      {
        p_session_id: sessionId,
        p_policy_key:
          'b2.7-live-default',
      }
    ),
    supabase.rpc(
      'd_finalize_weekly_session',
      {
        p_session_id: sessionId,
      }
    ),
  ];

  const analysisResults =
    await Promise.allSettled(
      analysisCalls
    );

  const analysisErrors =
    analysisResults
      .map((result, index) => {
        const labels = [
          'exercise_capability',
          'protocol_capability',
          'weekly_loop',
        ];

        if (
          result.status === 'rejected'
        ) {
          return {
            key: labels[index],
            error:
              result.reason?.message ??
              String(result.reason),
          };
        }

        if (result.value?.error) {
          return {
            key: labels[index],
            error:
              result.value.error.message ??
              String(result.value.error),
          };
        }

        return null;
      })
      .filter(Boolean);

  if (analysisErrors.length > 0) {
    console.warn(
      'Post-completion analysis',
      analysisErrors
    );
  }

  return {
    ...(data ?? {}),
    postCompletionAnalysis: {
      status:
        analysisErrors.length > 0
          ? 'PARTIAL'
          : 'OK',
      errors: analysisErrors,
    },
  };`;

if (!text.includes(oldBlock)) {
  throw new Error(
    'Bloc hyper-api-instance attendu introuvable dans src/services/workoutService.js. Aucun fichier modifié.'
  );
}

text = text.replace(oldBlock, newBlock);
fs.writeFileSync(filePath, text.replace(/\n/g, eol), 'utf8');

console.log('COMPLETION ATOMIC RPC PATCH APPLIED SUCCESSFULLY');
console.log('Modified: src/services/workoutService.js');
console.log('Authoritative save: complete_workout_session_v1 SECURITY DEFINER RPC.');
console.log('Saved atomically: workout_sessions + workout_session_exercises + exercise_logs + protocol outcome.');
console.log('Post-save non-blocking: capability + protocol capability + weekly loop.');
console.log('Fix: no direct authenticated mutation of protected workout tables.');
