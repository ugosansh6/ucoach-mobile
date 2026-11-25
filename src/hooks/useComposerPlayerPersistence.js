import { useEffect } from 'react';
import { AppState } from 'react-native';
import { isComposerWorkout, composerPlayerSnapshot, composerProgressFingerprint } from '../utils/composerPlayerProgress';
import { queueComposerPlayerProgress, flushComposerPlayerProgress, composerProgressSaveError } from '../services/composerPlayerProgressService';

export default function useComposerPlayerPersistence(workout, updateWorkout) {
  const enabled = isComposerWorkout(workout) && workout.sessionStarted && !workout.sessionClosed
    && !['completed', 'abandoned'].includes(workout.status) && workout.composerPlayerProgress?.loaded;
  const signature = enabled ? composerProgressFingerprint(composerPlayerSnapshot(workout, 0)) : '';
  useEffect(() => {
    if (!enabled) return;
    queueComposerPlayerProgress(workout).catch(() => {
      updateWorkout({ progressSaveError: 'Sauvegarde locale indisponible. Garde cette fenêtre ouverte et réessaie la sauvegarde.' });
    });
  }, [enabled, signature]);
  useEffect(() => {
    if (!enabled) return undefined;
    const save = async () => {
      try {
        await flushComposerPlayerProgress(workout.sessionId);
        const error = composerProgressSaveError(workout.sessionId);
        updateWorkout({ progressSaveError: error });
      } catch (error) {
        updateWorkout({ progressSaveError: error.message ?? 'La synchronisation est interrompue. Tes étapes restent conservées localement.' });
      }
    };
    const timer = setInterval(save, 10000);
    const appState = AppState.addEventListener('change', (state) => { if (state !== 'active') save(); });
    const visibility = () => { if (typeof document !== 'undefined' && document.visibilityState === 'hidden') save(); };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visibility);
    return () => {
      clearInterval(timer);
      appState.remove();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visibility);
      save();
    };
  }, [enabled, workout.sessionId, updateWorkout]);
}
