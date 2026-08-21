import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  colors,
  spacing,
} from '../../src/constants';
import { useWorkout } from '../../src/contexts/WorkoutContext';
import PreparationScreenContent from '../../src/workout/PreparationScreenContent';

export default function PreparationScreen() {
  const { workout } = useWorkout();

  const normalizedStatus = String(
    workout?.status ?? ''
  ).toLowerCase();

  const hasActiveSession = Boolean(
    workout?.sessionId
  ) && ![
    'completed',
    'abandoned',
  ].includes(normalizedStatus);

  const sessionStarted = Boolean(
    workout?.sessionStarted ||
      workout?.startedAt ||
      workout?.wodStarted ||
      workout?.wodStartedAt ||
      workout?.wodRuntime?.started ||
      normalizedStatus === 'in_progress'
  );

  function handleResumeSession() {
    router.replace('/workout/session');
  }

  return (
    <View style={styles.screen}>
      <PreparationScreenContent />

      {hasActiveSession ? (
        <View style={styles.resumeDock}>
          <View style={styles.guidanceRow}>
            <View style={styles.guidanceIcon}>
              <Ionicons
                name="swap-horizontal-outline"
                size={20}
                color={colors.primaryLight}
              />
            </View>

            <View style={styles.guidanceText}>
              <Text style={styles.guidanceTitle}>
                {sessionStarted
                  ? 'SÉANCE EN COURS'
                  : 'SÉANCE DÉJÀ GÉNÉRÉE'}
              </Text>
              <Text style={styles.guidanceBody}>
                Une gêne apparue pendant la séance ? Retourne à la séance et utilise Swap sur l’exercice concerné. Modifie le check-in ici seulement si tu veux régénérer l’ensemble de la séance.
              </Text>
            </View>
          </View>

          <Pressable
            onPress={handleResumeSession}
            style={({ pressed }) => [
              styles.resumeButton,
              pressed && styles.resumeButtonPressed,
            ]}
          >
            <Ionicons
              name="play-circle-outline"
              size={20}
              color={colors.brandWhite}
            />
            <Text style={styles.resumeButtonText}>
              RETOUR À LA SÉANCE EN COURS
            </Text>
            <Ionicons
              name="arrow-forward"
              size={18}
              color={colors.brandWhite}
            />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },

  resumeDock: {
    paddingHorizontal: spacing.xl,
    paddingTop: 11,
    paddingBottom: 13,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
    gap: 10,
  },

  guidanceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },

  guidanceIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8,104,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(8,104,255,0.24)',
  },

  guidanceText: {
    flex: 1,
  },

  guidanceTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.65,
    color: colors.primaryLight,
  },

  guidanceBody: {
    marginTop: 3,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 16,
    color: colors.textSecondary,
  },

  resumeButton: {
    minHeight: 50,
    borderRadius: 13,
    paddingHorizontal: 14,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },

  resumeButtonPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }],
  },

  resumeButtonText: {
    flex: 1,
    textAlign: 'center',
    fontFamily: 'Oswald_700Bold',
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.7,
    color: colors.brandWhite,
  },
});