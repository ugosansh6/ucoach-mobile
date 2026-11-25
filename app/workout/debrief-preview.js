import { useEffect } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, SafeAreaView, StyleSheet, Text } from 'react-native';

import { useUgerodTheme } from '../../src/contexts/UgerodThemeContext';
import { useWorkout } from '../../src/contexts/WorkoutContext';

const PREVIEW_SESSION_ID = '6e8f6c7d-c777-4f10-b1d1-07c8f8b7d828';

const PREVIEW_WORKOUT = {
  sessionId: PREVIEW_SESSION_ID,
  status: 'completed',
  plannedDuration: 45,
  startedAt: '2026-09-11T11:29:16.871Z',
  completedAt: '2026-09-11T12:14:16.871Z',
  preparationSnapshot: { environmentCode: 'HOME' },
  exercises: [
    { id: 'preview-warmup', sessionExerciseId: 'preview-warmup', blockKey: 'warmup', name: 'Activation générale', prescription: '6 min', status: 'completed' },
    { id: 'preview-skill', sessionExerciseId: 'preview-skill', blockKey: 'skill', name: 'Strict Pull-ups', prescription: '4 × 5', status: 'completed' },
    { id: 'preview-tabata-1', sessionExerciseId: 'preview-tabata-1', blockKey: 'tabata', name: 'Push-ups', prescription: '20 sec', status: 'completed' },
    { id: 'preview-tabata-2', sessionExerciseId: 'preview-tabata-2', blockKey: 'tabata', name: 'Hollow Hold', prescription: '20 sec', status: 'completed' },
    { id: 'preview-wod-1', sessionExerciseId: 'preview-wod-1', blockKey: 'wod', name: 'Goblet Squat', prescription: '12 reps', status: 'completed' },
    { id: 'preview-wod-2', sessionExerciseId: 'preview-wod-2', blockKey: 'wod', name: 'Burpee', prescription: '10 reps', status: 'completed' },
  ],
  wodRuntime: { started: true, mechanic: 'AMRAP', completedRounds: 5, reps: 12, elapsedSeconds: 840 },
};

export default function DebriefPreviewShortcut() {
  const { colors } = useUgerodTheme();
  const { updateWorkout } = useWorkout();

  useEffect(() => {
    updateWorkout(PREVIEW_WORKOUT);
    const frame = requestAnimationFrame(() => {
      router.replace({ pathname: '/workout/debrief', params: { sessionId: PREVIEW_SESSION_ID } });
    });
    return () => cancelAnimationFrame(frame);
  }, [updateWorkout]);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}> 
      <ActivityIndicator color={colors.accent} />
      <Text style={[styles.text, { color: colors.textSecondary }]}>Ouverture du débrief…</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  text: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
});
