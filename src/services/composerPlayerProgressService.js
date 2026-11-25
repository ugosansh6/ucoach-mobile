import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { getAuthenticatedUserWithRetry, runSupabaseRequestWithAuthRetry } from '../lib/supabaseAuthRetry';
import { composerPlayerSnapshot, composerProgressFingerprint } from '../utils/composerPlayerProgress';

const entries = new Map();
const storageKey = (userId, sessionId) => `ugerod:composer-player:v1:${userId}:${sessionId}`;

export async function loadComposerPlayerProgress(sessionId, confirmContractChange = false) {
  const user = await getAuthenticatedUserWithRetry();
  let state = await runSupabaseRequestWithAuthRetry(() => supabase.rpc('composer_player_progress_read_v1', { p_session_id: sessionId }));
  if (state.status === 'CONTRACT_CHANGED' && confirmContractChange) {
    const result = await runSupabaseRequestWithAuthRetry(() => supabase.rpc('composer_player_progress_rebase_v1', {
      p_session_id: sessionId, p_expected_contract_key: state.contract_key,
    }));
    if (['REBASED', 'UNCHANGED'].includes(result.status)) {
      state = { ...await runSupabaseRequestWithAuthRetry(() => supabase.rpc('composer_player_progress_read_v1', { p_session_id: sessionId })), rebased: result.status === 'REBASED' };
    }
  }
  if (state.status === 'CONTRACT_CHANGED') {
    throw new Error('Le contenu de cette séance a été modifié après son exécution. Le réalisé est conservé ; une vérification de compatibilité est nécessaire avant de reprendre.');
  }
  let cached = null;
  try { cached = JSON.parse(await AsyncStorage.getItem(storageKey(user.id, sessionId))); } catch { /* Remote state remains authoritative. */ }
  const canResumeCache = !state.closed && cached?.contractKey === state.contract_key
    && Number(cached?.revision) === Number(state.revision)
    && Number(cached?.progress?.clientUpdatedAt ?? 0) > Number(state.progress?.clientUpdatedAt ?? 0);
  const progress = canResumeCache ? cached.progress : state.progress;
  entries.set(sessionId, { userId: user.id, contractKey: state.contract_key, revision: Number(state.revision),
    latest: progress, acknowledged: composerProgressFingerprint(state.progress), closed: state.closed, inflight: null });
  return { ...state, progress };
}

export async function queueComposerPlayerProgress(workout) {
  const entry = entries.get(workout.sessionId);
  if (!entry || entry.closed || !workout.sessionStarted || workout.sessionClosed || !workout.composerPlayerProgress?.loaded) return;
  const next = composerPlayerSnapshot(workout, Math.max(Date.now(), Number(entry.latest?.clientUpdatedAt ?? 0) + 1));
  if (composerProgressFingerprint(next) === composerProgressFingerprint(entry.latest)) return;
  entry.latest = next;
  entry.cachePromise = AsyncStorage.setItem(storageKey(entry.userId, workout.sessionId), JSON.stringify({
    contractKey: entry.contractKey, revision: entry.revision, progress: next,
  }));
  await entry.cachePromise;
  // Clock ticks are cached locally immediately. Round/set/pause/status changes
  // flush promptly; a separate maximum wait also syncs a running clock.
  const structural = composerProgressFingerprint(next, false);
  if (structural !== entry.structural) {
    entry.structural = structural;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => flushComposerPlayerProgress(workout.sessionId).catch((error) => { entry.error = error; }), 300);
  }
}

export async function flushComposerPlayerProgress(sessionId) {
  const entry = entries.get(sessionId);
  if (!entry || entry.closed || !entry.latest) return;
  if (entry.inflight) { await entry.inflight; return flushComposerPlayerProgress(sessionId); }
  if (entry.error?.code === 'COMPOSER_PROGRESS_CONFLICT') throw entry.error;
  const fingerprint = composerProgressFingerprint(entry.latest);
  if (fingerprint === entry.acknowledged) return;
  const progress = entry.latest;
  entry.inflight = (async () => {
    await entry.cachePromise;
    const result = await runSupabaseRequestWithAuthRetry(() => supabase.rpc('composer_player_progress_save_v1', {
      p_session_id: sessionId, p_contract_key: entry.contractKey,
      p_expected_revision: entry.revision, p_progress: progress,
    }));
    if (result.status !== 'SAVED') {
      const error = new Error('La séance a changé dans une autre fenêtre ou après adaptation. Recharge-la pour reprendre sans écraser les résultats.');
      error.code = 'COMPOSER_PROGRESS_CONFLICT'; entry.error = error; throw error;
    }
    entry.revision = Number(result.revision);
    entry.acknowledged = fingerprint;
    entry.error = null;
    await AsyncStorage.setItem(storageKey(entry.userId, sessionId), JSON.stringify({
      contractKey: entry.contractKey, revision: entry.revision, progress: entry.latest,
    }));
  })();
  try { await entry.inflight; } finally { entry.inflight = null; }
}

export function composerProgressSaveError(sessionId) {
  return entries.get(sessionId)?.error?.message ?? null;
}

export async function checkpointComposerPlayerProgress(workout) {
  await queueComposerPlayerProgress(workout);
  await flushComposerPlayerProgress(workout.sessionId);
}
