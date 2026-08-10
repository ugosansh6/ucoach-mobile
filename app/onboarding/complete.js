import { useState } from 'react';
import { router } from 'expo-router';

import {
  ActivityIndicator,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  colors,
  spacing,
  typography,
} from '../../src/constants';

import { useOnboarding } from '../../src/contexts/OnboardingContext';

import {
  saveOnboardingProfile,
  markOnboardingCompleted,
} from '../../src/services/profileService';

import {
  savePrimaryGoal,
} from '../../src/services/goalsService';

const brandLogo = require(
  '../../assets/branding/ugerod-logo-white.png'
);

const LEVEL_LABELS = {
  beginner: 'DÉBUTANT',
  intermediate: 'INTERMÉDIAIRE',
  advanced: 'AVANCÉ',
};

const GOAL_LABELS = {
  'General Fitness': 'FORME GÉNÉRALE',
  'Fat Loss': 'PERTE DE GRAS',
  'Muscle Gain': 'PRISE DE MUSCLE',
  Strength: 'FORCE',
  Conditioning: 'CONDITIONING',
  Skill: 'SKILL',
};

export default function CompleteScreen() {
  const {
    level,
    goal,
    weeklyTarget,
    precautions,
  } = useOnboarding();

  const [isSaving, setIsSaving] =
    useState(false);

  const [errorMessage, setErrorMessage] =
    useState('');

  function handleBack() {
    if (isSaving) {
      return;
    }

    router.back();
  }

  async function handleStart() {
    if (isSaving) {
      return;
    }

    try {
      setIsSaving(true);
      setErrorMessage('');

      console.log(
        'ONBOARDING — début sauvegarde',
        {
          level,
          goal,
          weeklyTarget,
          precautions,
        }
      );

      /*
       * ÉTAPE 1
       * Création / mise à jour du profil.
       */
      const profile =
        await saveOnboardingProfile({
          level,
          weeklyTarget,
          precautions,
        });

      console.log(
        'ONBOARDING — profil sauvegardé',
        {
          profile_id: profile?.id,
        }
      );

      /*
       * ÉTAPE 2
       * Enregistrement de l'objectif principal.
       */
      const savedGoal =
        await savePrimaryGoal(goal);

      console.log(
        'ONBOARDING — objectif sauvegardé',
        {
          goal_id:
            savedGoal?.goal_id,
          goal_name:
            savedGoal?.goal?.name,
        }
      );

      /*
       * ÉTAPE 3
       * On considère l'onboarding terminé
       * uniquement si profil + objectif
       * ont été correctement enregistrés.
       */
      const completedProfile =
        await markOnboardingCompleted();

      console.log(
        'ONBOARDING — terminé',
        {
          profile_id:
            completedProfile?.id,
          onboarding_completed:
            completedProfile
              ?.onboarding_completed,
        }
      );

      /*
       * ÉTAPE 4
       * Dashboard uniquement après succès DB.
       */
      router.replace('/(tabs)');
    } catch (error) {
      console.log(
        'ONBOARDING SAVE ERROR',
        {
          message: error?.message,
          code: error?.code,
          details: error?.details,
          hint: error?.hint,
        }
      );

      setErrorMessage(
        error?.message ??
          'Impossible de créer ton profil pour le moment.'
      );
    } finally {
      setIsSaving(false);
    }
  }

  const levelLabel =
    LEVEL_LABELS[level] ||
    'NON RENSEIGNÉ';

  const goalLabel =
    GOAL_LABELS[goal] ||
    'NON RENSEIGNÉ';

  const frequencyLabel =
    weeklyTarget
      ? `${weeklyTarget} SÉANCES / SEMAINE`
      : 'NON RENSEIGNÉ';

  const precautionsList =
    precautions &&
    precautions.length > 0
      ? precautions
      : ['AUCUNE'];

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={
          styles.scrollContent
        }
      >
        {/* HEADER */}
        <View style={styles.header}>
          <Pressable
            onPress={handleBack}
            disabled={isSaving}
            hitSlop={12}
            style={({ pressed }) => [
              styles.backButton,
              pressed &&
                !isSaving &&
                styles.pressed,
            ]}
          >
            <Text style={styles.backIcon}>
              ‹
            </Text>
          </Pressable>

          <Image
            source={brandLogo}
            style={styles.logo}
            resizeMode="contain"
          />

          <View
            style={styles.headerSpacer}
          />
        </View>

        {/* PROGRESSION */}
        <View style={styles.progressArea}>
          <Text style={styles.stepText}>
            ÉTAPE 5 SUR 5
          </Text>

          <View
            style={styles.progressTrack}
          >
            <View
              style={styles.progressFill}
            />
          </View>
        </View>

        {/* TITRE */}
        <View style={styles.titleArea}>
          <Text style={styles.title}>
            TON PROFIL EST PRÊT
            <Text
              style={styles.blueDot}
            >
              .
            </Text>
          </Text>

          <Text style={styles.subtitle}>
            Vérifie tes informations avant
            d’entrer dans UGEROD.
          </Text>
        </View>

        {/* RÉCAP */}
        <View style={styles.summary}>
          <SummaryRow
            label="NIVEAU"
            value={levelLabel}
          />

          <SummaryRow
            label="OBJECTIF"
            value={goalLabel}
          />

          <SummaryRow
            label="RYTHME"
            value={frequencyLabel}
          />

          <View
            style={styles.summaryCard}
          >
            <Text
              style={styles.summaryLabel}
            >
              GÊNES À PRENDRE EN COMPTE
            </Text>

            <View style={styles.chips}>
              {precautionsList.map(
                (item) => (
                  <View
                    key={item}
                    style={styles.chip}
                  >
                    <Text
                      style={
                        styles.chipText
                      }
                    >
                      {item.toUpperCase()}
                    </Text>
                  </View>
                )
              )}
            </View>
          </View>
        </View>

        {/* INFO */}
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>
            RIEN N’EST FIGÉ
          </Text>

          <Text style={styles.infoText}>
            Tu pourras modifier ces
            informations plus tard depuis
            ton profil. Le matériel, le
            temps disponible et ta forme
            du jour seront définis avant
            chaque séance.
          </Text>
        </View>

        {/* ERREUR */}
        {!!errorMessage && (
          <View style={styles.errorCard}>
            <Text
              style={styles.errorTitle}
            >
              IMPOSSIBLE D’ENREGISTRER
            </Text>

            <Text
              style={styles.errorText}
            >
              {errorMessage}
            </Text>
          </View>
        )}

        <View style={styles.spacer} />

        {/* CTA */}
        <Pressable
          onPress={handleStart}
          disabled={isSaving}
          style={({ pressed }) => [
            styles.primaryButton,
            pressed &&
              !isSaving &&
              styles.primaryButtonPressed,
            isSaving &&
              styles.primaryButtonDisabled,
          ]}
        >
          {isSaving ? (
            <>
              <ActivityIndicator
                size="small"
                color={colors.brandWhite}
              />

              <Text
                style={
                  styles.primaryButtonText
                }
              >
                CRÉATION DU PROFIL...
              </Text>
            </>
          ) : (
            <Text
              style={
                styles.primaryButtonText
              }
            >
              ENTRER DANS UGEROD
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function SummaryRow({
  label,
  value,
}) {
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryLabel}>
        {label}
      </Text>

      <Text style={styles.summaryValue}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor:
      colors.background,
  },

  scrollContent: {
    flexGrow: 1,
    paddingHorizontal:
      spacing.xl,
    paddingBottom:
      spacing.xl,
  },

  header: {
    minHeight: 90,
    flexDirection: 'row',
    alignItems: 'center',
  },

  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  backIcon: {
    color:
      colors.textPrimary,
    fontSize: 40,
    lineHeight: 40,
    fontFamily:
      'Oswald_400Regular',
  },

  logo: {
    flex: 1,
    height: 64,
    maxWidth: 190,
    alignSelf: 'center',
  },

  headerSpacer: {
    width: 44,
  },

  progressArea: {
    marginTop:
      spacing.sm,
    marginBottom:
      spacing.xxl,
  },

  stepText: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 12,
    letterSpacing: 1,
    color:
      colors.textSecondary,
    marginBottom: 10,
  },

  progressTrack: {
    height: 3,
    backgroundColor:
      colors.surfaceElevated,
    borderRadius: 999,
    overflow: 'hidden',
  },

  progressFill: {
    width: '100%',
    height: '100%',
    backgroundColor:
      colors.primary,
  },

  titleArea: {
    marginBottom:
      spacing.xxl,
  },

  title: {
    ...typography.display,
    color:
      colors.textPrimary,
    fontSize: 42,
    lineHeight: 46,
    letterSpacing: 2,
  },

  blueDot: {
    color:
      colors.primary,
  },

  subtitle: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 16,
    lineHeight: 23,
    color:
      colors.textSecondary,
    marginTop:
      spacing.sm,
    maxWidth: 380,
  },

  summary: {
    gap:
      spacing.md,
  },

  summaryCard: {
    backgroundColor:
      colors.surface,
    borderWidth: 1,
    borderColor:
      colors.border,
    borderRadius: 16,
    paddingHorizontal:
      spacing.lg,
    paddingVertical:
      spacing.lg,
  },

  summaryLabel: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.9,
    color:
      colors.textSecondary,
  },

  summaryValue: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 20,
    lineHeight: 26,
    color:
      colors.textPrimary,
    marginTop: 6,
  },

  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop:
      spacing.sm,
  },

  chip: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor:
      'rgba(8, 104, 255, 0.10)',
    borderWidth: 1,
    borderColor:
      colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  chipText: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 13,
    lineHeight: 17,
    letterSpacing: 0.4,
    color:
      colors.primaryLight,
  },

  infoCard: {
    marginTop:
      spacing.xxl,
    borderRadius: 16,
    backgroundColor:
      colors.backgroundSoft,
    borderWidth: 1,
    borderColor:
      colors.border,
    padding:
      spacing.lg,
  },

  infoTitle: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 0.8,
    color:
      colors.textPrimary,
  },

  infoText: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 14,
    lineHeight: 21,
    color:
      colors.textSecondary,
    marginTop:
      spacing.xs,
  },

  errorCard: {
    marginTop:
      spacing.lg,
    borderRadius: 14,
    padding:
      spacing.lg,
    backgroundColor:
      'rgba(227,27,35,0.08)',
    borderWidth: 1,
    borderColor:
      'rgba(227,27,35,0.35)',
  },

  errorTitle: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 12,
    lineHeight: 16,
    color: '#FF6B6B',
  },

  errorText: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color:
      colors.textSecondary,
    marginTop: 4,
  },

  spacer: {
    flex: 1,
    minHeight:
      spacing.xxl,
  },

  primaryButton: {
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    backgroundColor:
      colors.primary,
    borderRadius: 14,
    paddingHorizontal:
      spacing.xl,
    marginTop:
      spacing.xxl,
  },

  primaryButtonPressed: {
    backgroundColor:
      colors.primaryDark,
    transform: [
      {
        scale: 0.985,
      },
    ],
  },

  primaryButtonDisabled: {
    opacity: 0.65,
  },

  primaryButtonText: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 20,
    lineHeight: 23,
    letterSpacing: 1.2,
    color:
      colors.brandWhite,
  },

  pressed: {
    opacity: 0.65,
  },
});