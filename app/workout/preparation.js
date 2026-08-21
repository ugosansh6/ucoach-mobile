import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Modal,
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
import { getSessionWhy } from '../../src/services/sessionWhyService';

export default function PreparationScreen() {
  const { workout } = useWorkout();

  const [whyVisible, setWhyVisible] =
    useState(false);
  const [whyLoading, setWhyLoading] =
    useState(false);
  const [whyData, setWhyData] =
    useState(null);
  const [whyError, setWhyError] =
    useState('');

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

  useEffect(() => {
    setWhyVisible(false);
    setWhyData(null);
    setWhyError('');
    setWhyLoading(false);
  }, [workout?.sessionId]);

  function handleResumeSession() {
    router.replace('/workout/session');
  }

  async function handleShowWhy() {
    if (!workout?.sessionId) {
      return;
    }

    setWhyVisible(true);
    setWhyLoading(true);
    setWhyError('');

    try {
      const result = await getSessionWhy(
        workout.sessionId
      );
      setWhyData(result);
    } catch (error) {
      setWhyData(null);
      setWhyError(
        error?.message ??
          'Impossible de charger les raisons de cette séance.'
      );
    } finally {
      setWhyLoading(false);
    }
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
            onPress={handleShowWhy}
            style={({ pressed }) => [
              styles.whyButton,
              pressed && styles.whyButtonPressed,
            ]}
          >
            <View style={styles.whyButtonIcon}>
              <Ionicons
                name="sparkles-outline"
                size={18}
                color={colors.primaryLight}
              />
            </View>
            <View style={styles.whyButtonTextWrap}>
              <Text style={styles.whyButtonTitle}>
                POURQUOI CETTE SÉANCE ?
              </Text>
              <Text style={styles.whyButtonSubtitle}>
                Voir les décisions réelles utilisées par UGEROD.
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={colors.textMuted}
            />
          </Pressable>

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

      <Modal
        visible={whyVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setWhyVisible(false)}
      >
        <View style={styles.whyModalOverlay}>
          <Pressable
            style={styles.whyModalBackdrop}
            onPress={() => setWhyVisible(false)}
          />

          <View style={styles.whyModalCard}>
            <View style={styles.whyModalHeader}>
              <View style={styles.whyModalTitleWrap}>
                <Text style={styles.whyModalEyebrow}>
                  COACH UGEROD
                </Text>
                <Text style={styles.whyModalTitle}>
                  POURQUOI CETTE SÉANCE ?
                </Text>
                <Text style={styles.whyModalSubtitle}>
                  Seulement les raisons réellement présentes dans la trace de décision.
                </Text>
              </View>

              <Pressable
                onPress={() => setWhyVisible(false)}
                hitSlop={10}
                style={styles.whyModalClose}
              >
                <Ionicons
                  name="close"
                  size={20}
                  color={colors.textPrimary}
                />
              </Pressable>
            </View>

            {whyLoading ? (
              <View style={styles.whyLoading}>
                <ActivityIndicator
                  size="small"
                  color={colors.primaryLight}
                />
                <Text style={styles.whyLoadingText}>
                  UGEROD relit la trace de cette séance…
                </Text>
              </View>
            ) : whyError ? (
              <View style={styles.whyErrorCard}>
                <Ionicons
                  name="alert-circle-outline"
                  size={19}
                  color={colors.brandRed}
                />
                <Text style={styles.whyErrorText}>
                  {whyError}
                </Text>
              </View>
            ) : Array.isArray(whyData?.reasons) &&
              whyData.reasons.length > 0 ? (
              <View style={styles.whyReasons}>
                {whyData.reasons.map((reason, index) => (
                  <View
                    key={`${reason?.type ?? 'reason'}-${index}`}
                    style={styles.whyReasonRow}
                  >
                    <View style={styles.whyReasonIndex}>
                      <Text style={styles.whyReasonIndexText}>
                        {index + 1}
                      </Text>
                    </View>
                    <Text style={styles.whyReasonText}>
                      {reason.text}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.whyEmptyCard}>
                <Ionicons
                  name="information-circle-outline"
                  size={19}
                  color={colors.textMuted}
                />
                <Text style={styles.whyEmptyText}>
                  La trace disponible ne permet pas encore d’expliquer cette séance sans inventer de causalité.
                </Text>
              </View>
            )}
          </View>
        </View>
      </Modal>
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

  whyButton: {
    minHeight: 58,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: 'rgba(8,104,255,0.28)',
    backgroundColor: 'rgba(8,104,255,0.07)',
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  whyButtonPressed: {
    opacity: 0.72,
  },

  whyButtonIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8,104,255,0.12)',
  },

  whyButtonTextWrap: {
    flex: 1,
  },

  whyButtonTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.65,
    color: colors.textPrimary,
  },

  whyButtonSubtitle: {
    marginTop: 2,
    fontFamily: 'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 14,
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

  whyModalOverlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },

  whyModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.76)',
  },

  whyModalCard: {
    borderRadius: 20,
    padding: 18,
    backgroundColor: '#11151A',
    borderWidth: 1,
    borderColor: 'rgba(8,104,255,0.30)',
  },

  whyModalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },

  whyModalTitleWrap: {
    flex: 1,
  },

  whyModalEyebrow: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.9,
    color: colors.primaryLight,
  },

  whyModalTitle: {
    marginTop: 3,
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 27,
    lineHeight: 30,
    letterSpacing: 1.1,
    color: colors.textPrimary,
  },

  whyModalSubtitle: {
    marginTop: 5,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color: colors.textSecondary,
  },

  whyModalClose: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },

  whyLoading: {
    minHeight: 92,
    marginTop: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },

  whyLoadingText: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    color: colors.textSecondary,
  },

  whyReasons: {
    marginTop: 17,
    gap: 10,
  },

  whyReasonRow: {
    minHeight: 58,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.025)',
    padding: 11,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },

  whyReasonIndex: {
    width: 27,
    height: 27,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },

  whyReasonIndexText: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    color: colors.brandWhite,
  },

  whyReasonText: {
    flex: 1,
    fontFamily: 'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color: colors.textPrimary,
  },

  whyErrorCard: {
    marginTop: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,59,59,0.38)',
    backgroundColor: 'rgba(255,59,59,0.07)',
    padding: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },

  whyErrorText: {
    flex: 1,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 16,
    color: colors.brandRed,
  },

  whyEmptyCard: {
    marginTop: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.025)',
    padding: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },

  whyEmptyText: {
    flex: 1,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 16,
    color: colors.textSecondary,
  },
});