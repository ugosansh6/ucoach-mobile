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

import { colors, spacing, typography } from '../../src/constants';
import { useOnboarding } from '../../src/contexts/OnboardingContext';
import {
  saveOnboardingProfile,
  markOnboardingCompleted,
} from '../../src/services/profileService';
import { savePrimaryGoal } from '../../src/services/goalsService';

const brandLogo = require('../../assets/branding/ugerod-logo-white.png');

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
};

const DIMENSION_LABELS = {
  strength: 'FORCE',
  cardio_endurance: 'CARDIO / ENDURANCE',
  bodyweight: 'POIDS DU CORPS / GYMNASTIQUE',
  explosiveness: 'EXPLOSIVITÉ',
  mobility: 'MOBILITÉ',
};

export default function CompleteScreen() {
  const {
    level,
    goal,
    weeklyTarget,
    startingProfile,
    precautions,
  } = useOnboarding();

  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  async function handleStart() {
    if (isSaving) return;

    try {
      setIsSaving(true);
      setErrorMessage('');

      console.log('ONBOARDING — début sauvegarde', {
        level,
        goal,
        weeklyTarget,
        startingProfile,
        precautions,
      });

      const profile = await saveOnboardingProfile({
        level,
        weeklyTarget,
        startingProfile,
        precautions,
      });

      console.log('ONBOARDING — profil sauvegardé', {
        profile_id: profile?.id,
        athletic_starting_profile: profile?.athletic_starting_profile,
      });

      const savedGoal = await savePrimaryGoal(goal);

      console.log('ONBOARDING — objectif sauvegardé', {
        goal_id: savedGoal?.goal_id,
        goal_name: savedGoal?.goal?.name,
      });

      const completedProfile = await markOnboardingCompleted();

      console.log('ONBOARDING — terminé', {
        profile_id: completedProfile?.id,
        onboarding_completed: completedProfile?.onboarding_completed,
      });

      router.replace('/(tabs)');
    } catch (error) {
      console.log('ONBOARDING SAVE ERROR', {
        message: error?.message,
        code: error?.code,
        details: error?.details,
        hint: error?.hint,
      });

      setErrorMessage(
        error?.message ?? 'Impossible de créer ton profil pour le moment.'
      );
    } finally {
      setIsSaving(false);
    }
  }

  const levelLabel = LEVEL_LABELS[level] || 'NON RENSEIGNÉ';
  const goalLabel = GOAL_LABELS[goal] || 'NON RENSEIGNÉ';
  const frequencyLabel = weeklyTarget
    ? `${weeklyTarget} SÉANCES / SEMAINE`
    : 'NON RENSEIGNÉ';

  const precautionsList =
    precautions && precautions.length > 0 ? precautions : ['AUCUNE'];

  const strengths = startingProfile?.strengths ?? [];
  const weaknesses = startingProfile?.weaknesses ?? [];
  const unsure = startingProfile?.unsure ?? false;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.header}>
          <Pressable
            onPress={() => !isSaving && router.back()}
            disabled={isSaving}
            hitSlop={12}
            style={({ pressed }) => [
              styles.backButton,
              pressed && !isSaving && styles.pressed,
            ]}
          >
            <Text style={styles.backIcon}>‹</Text>
          </Pressable>

          <Image source={brandLogo} style={styles.logo} resizeMode="contain" />
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.progressArea}>
          <Text style={styles.stepText}>ÉTAPE 6 SUR 6</Text>
          <View style={styles.progressTrack}>
            <View style={styles.progressFill} />
          </View>
        </View>

        <View style={styles.titleArea}>
          <Text style={styles.title}>
            TON PROFIL EST PRÊT<Text style={styles.blueDot}>.</Text>
          </Text>
          <Text style={styles.subtitle}>
            Vérifie tes informations avant d’entrer dans UGEROD.
          </Text>
        </View>

        <View style={styles.summary}>
          <SummaryRow label="NIVEAU" value={levelLabel} />
          <SummaryRow label="OBJECTIF" value={goalLabel} />
          <SummaryRow label="RYTHME" value={frequencyLabel} />

          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>PROFIL DE DÉPART</Text>

            {unsure ? (
              <View style={styles.neutralProfile}>
                <Text style={styles.neutralTitle}>JE NE SAIS PAS</Text>
                <Text style={styles.neutralText}>
                  Base neutre : 3/5 sur toutes les dimensions.
                </Text>
              </View>
            ) : (
              <>
                <ProfileGroup
                  label="POINTS FORTS · 4/5"
                  values={strengths}
                  tone="strong"
                />
                <ProfileGroup
                  label="POINTS FAIBLES · 2/5"
                  values={weaknesses}
                  tone="weak"
                />
                <Text style={styles.neutralText}>
                  Les autres dimensions démarrent à 3/5.
                </Text>
              </>
            )}
          </View>

          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>GÊNES À PRENDRE EN COMPTE</Text>
            <View style={styles.chips}>
              {precautionsList.map((item) => (
                <View key={item} style={styles.chip}>
                  <Text style={styles.chipText}>{item.toUpperCase()}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>RIEN N’EST FIGÉ</Text>
          <Text style={styles.infoText}>
            Le profil de départ sert uniquement à estimer ton niveau initial.
            Les performances observées par UGEROD prendront progressivement le
            dessus. Tu pourras aussi modifier tes informations depuis ton profil.
          </Text>
        </View>

        {!!errorMessage && (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>IMPOSSIBLE D’ENREGISTRER</Text>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        )}

        <View style={styles.spacer} />

        <Pressable
          onPress={handleStart}
          disabled={isSaving}
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && !isSaving && styles.primaryButtonPressed,
            isSaving && styles.primaryButtonDisabled,
          ]}
        >
          {isSaving ? (
            <>
              <ActivityIndicator size="small" color={colors.brandWhite} />
              <Text style={styles.primaryButtonText}>CRÉATION DU PROFIL...</Text>
            </>
          ) : (
            <Text style={styles.primaryButtonText}>ENTRER DANS UGEROD</Text>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function SummaryRow({ label, value }) {
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

function ProfileGroup({ label, values, tone }) {
  const hasValues = values.length > 0;

  return (
    <View style={styles.profileGroup}>
      <Text style={styles.profileGroupLabel}>{label}</Text>
      <View style={styles.chips}>
        {hasValues ? (
          values.map((item) => (
            <View
              key={`${tone}-${item}`}
              style={[
                styles.chip,
                tone === 'strong' ? styles.strongChip : styles.weakChip,
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  tone === 'strong'
                    ? styles.strongChipText
                    : styles.weakChipText,
                ]}
              >
                {DIMENSION_LABELS[item] ?? item.toUpperCase()}
              </Text>
            </View>
          ))
        ) : (
          <Text style={styles.emptyProfileText}>AUCUN</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  header: { minHeight: 90, flexDirection: 'row', alignItems: 'center' },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIcon: {
    color: colors.textPrimary,
    fontSize: 40,
    lineHeight: 40,
    fontFamily: 'Oswald_400Regular',
  },
  logo: { flex: 1, height: 64, maxWidth: 190, alignSelf: 'center' },
  headerSpacer: { width: 44 },
  progressArea: { marginTop: spacing.sm, marginBottom: spacing.xxl },
  stepText: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 12,
    letterSpacing: 1,
    color: colors.textSecondary,
    marginBottom: 10,
  },
  progressTrack: {
    height: 3,
    backgroundColor: colors.surfaceElevated,
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: { width: '100%', height: '100%', backgroundColor: colors.primary },
  titleArea: { marginBottom: spacing.xxl },
  title: {
    ...typography.display,
    color: colors.textPrimary,
    fontSize: 42,
    lineHeight: 46,
    letterSpacing: 2,
  },
  blueDot: { color: colors.primary },
  subtitle: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 16,
    lineHeight: 23,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    maxWidth: 380,
  },
  summary: { gap: spacing.md },
  summaryCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  summaryLabel: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.9,
    color: colors.textSecondary,
  },
  summaryValue: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 20,
    lineHeight: 26,
    color: colors.textPrimary,
    marginTop: 6,
  },
  profileGroup: { marginTop: spacing.md },
  profileGroupLabel: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.6,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: spacing.sm,
  },
  chip: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.primaryTransparent,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  strongChip: {
    backgroundColor: colors.primaryTransparent,
    borderColor: colors.primary,
  },
  weakChip: {
    backgroundColor: colors.errorTransparent,
    borderColor: colors.error,
  },
  chipText: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 13,
    lineHeight: 17,
    letterSpacing: 0.4,
    color: colors.primaryLight,
  },
  strongChipText: { color: colors.primaryLight },
  weakChipText: { color: colors.error },
  emptyProfileText: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 13,
    color: colors.textMuted,
  },
  neutralProfile: { marginTop: spacing.md },
  neutralTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 17,
    color: colors.textPrimary,
  },
  neutralText: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
    marginTop: 8,
  },
  infoCard: {
    marginTop: spacing.xxl,
    borderRadius: 16,
    backgroundColor: colors.backgroundSoft,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  infoTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 0.8,
    color: colors.textPrimary,
  },
  infoText: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  errorCard: {
    marginTop: spacing.lg,
    borderRadius: 14,
    padding: spacing.lg,
    backgroundColor: colors.errorTransparent,
    borderWidth: 1,
    borderColor: 'rgba(255,59,59,0.35)',
  },
  errorTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 12,
    lineHeight: 16,
    color: colors.error,
  },
  errorText: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
    marginTop: 4,
  },
  spacer: { flex: 1, minHeight: spacing.xxl },
  primaryButton: {
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.xxl,
  },
  primaryButtonPressed: {
    backgroundColor: colors.primaryDark,
    transform: [{ scale: 0.985 }],
  },
  primaryButtonDisabled: { opacity: 0.65 },
  primaryButtonText: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 20,
    lineHeight: 23,
    letterSpacing: 1.2,
    color: colors.brandWhite,
  },
  pressed: { opacity: 0.65 },
});
