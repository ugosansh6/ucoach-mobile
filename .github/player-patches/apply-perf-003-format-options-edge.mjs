import fs from 'node:fs';

const path = 'src/services/workoutService.js';
let source = fs.readFileSync(path, 'utf8');

const start = source.indexOf('export async function getWorkoutFormatOptions(sessionId) {');
const end = source.indexOf('export async function reloadWorkoutSession({', start);
if (start < 0 || end < 0) throw new Error('getWorkoutFormatOptions block not found');

const replacement = `export async function getWorkoutFormatOptions(sessionId) {
  if (!sessionId) {
    throw new Error(
      "Impossible de charger les formats : session_id manquant."
    );
  }

  const { data, error } =
    await supabase.functions.invoke(
      'change-workout-format',
      {
        body: {
          action: 'OPTIONS',
          session_id: sessionId,
        },
      }
    );

  if (error) {
    let detail = null;

    try {
      detail =
        await error?.context?.json();
    } catch {
      detail = null;
    }

    throw new Error(
      detail?.error ??
        detail?.message ??
        error?.message ??
        'Impossible de charger les formats disponibles.'
    );
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return {
    sessionId:
      data?.session_id ?? sessionId,
    subscriptionTier:
      data?.subscription_tier ?? 'FREE',
    currentMechanic:
      data?.current_mechanic ?? null,
    currentVariant:
      data?.current_variant ?? null,
    wodRevealedAt:
      data?.wod_revealed_at ?? null,
    wodStartedAt:
      data?.wod_started_at ?? null,
    formatChangeCount:
      Number(data?.format_change_count ?? 0),
    formatChangeLimit:
      Number(data?.format_change_limit ?? 3),
    remainingFormatChanges:
      Number(data?.remaining_format_changes ?? 0),
    formatLocked:
      Boolean(data?.format_locked),
    options:
      Array.isArray(data?.options)
        ? data.options
        : [],
    version:
      data?.version ?? null,
    timingMs:
      Number(data?.timing_ms ?? 0),
  };
}

`;

source = source.slice(0, start) + replacement + source.slice(end);
fs.writeFileSync(path, source);
