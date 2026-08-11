import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useOnboarding } from '../../src/contexts/OnboardingContext';
import { colors, spacing, typography } from '../../src/constants';

const brandLogo = require('../../assets/branding/ugerod-logo-white.png');

const DIMENSIONS = [
  { id: 'strength', title: 'FORCE' },
  { id: 'cardio_endurance', title: 'CARDIO / ENDURANCE' },
  { id: 'bodyweight', title: 'POIDS DU CORPS / GYMNASTIQUE' },
  { id: 'explosiveness', title: 'EXPLOSIVITÉ' },
  { id: 'mobility', title: 'MOBILITÉ' },
];

export default function AthleticProfileScreen() {
  const { startingProfile, setStartingProfile } = useOnboarding();

  const strengths = startingProfile?.strengths ?? [];
  const weaknesses = startingProfile?.weaknesses ?? [];
  const unsure = startingProfile?.unsure ?? false;

  const canContinue =
    unsure || strengths.length > 0 || weaknesses.length > 0;

  function setDimensionState(id, nextState) {
    setStartingProfile((current) => {
      const currentStrengths = current?.strengths ?? [];
      const currentWeaknesses = current?.weaknesses ?? [];

      const isStrength = currentStrengths.includes(id);
      const isWeakness = currentWeaknesses.includes(id);

      if (nextState === 'strong') {
        if (isStrength) {
          return {
            strengths: currentStrengths.filter((item) => item !== id),
            weaknesses: currentWeaknesses,
            unsure: false,
          };
        }

        if (currentStrengths.length >= 2) {
          return current;
        }

        return {
          strengths: [...currentStrengths, id],
          weaknesses: currentWeaknesses.filter((item) => item !== id),
          unsure: false,
        };
      }

      if (nextState === 'weak') {
        if (isWeakness) {
          return {
            strengths: currentStrengths,
            weaknesses: currentWeaknesses.filter((item) => item !== id),
            unsure: false,
          };
        }

        if (currentWeaknesses.length >= 2) {
          return current;
        }

        return {
          strengths: currentStrengths.filter((item) => item !== id),
          weaknesses: [...currentWeaknesses, id],
          unsure: false,
        };
      }

      return current;
    });
  }

  function handleUnsure() {
    setStartingProfile({
      strengths: [],
      weaknesses: [],
      unsure: true,
    });
  }

  function handleNext() {
    if (!canContinue) return;
    router.push('/onboarding/precautions');
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            style={({ pressed }) => [
              styles.backButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.backIcon}>‹</Text>
          </Pressable>

          <Image
            source={brandLogo}
            style={styles.logo}
            resizeMode="contain"
          />

          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.progressArea}>
          <Text style={styles.stepText}>ÉTAPE 4 SUR 6</Text>

          <View style={styles.progressTrack}>
            <View style={styles.progressFill} />
          </View>
        </View>

        <View style={styles.titleArea}>
          <Text style={styles.title}>
            TON PROFIL DE DÉPART<Text style={styles.blueDot}>.</Text>
          </Text>

          <Text style={styles.subtitle}>
            Indique simplement ce qui te semble aujourd’hui être un point fort
            ou un point faible. Tout le reste reste neutre.
          </Text>
        </View>

        <View style={styles.counterCard}>
          <View style={styles.counterItem}>
            <View style={[styles.counterDot, styles.counterDotWeak]} />
            <Text style={styles.counterLabel}>POINTS FAIBLES</Text>
            <Text style={styles.counterValue}>{weaknesses.length}/2</Text>
          </View>

          <View style={styles.counterDivider} />

          <View style={styles.counterItem}>
            <View style={[styles.counterDot, styles.counterDotStrong]} />
            <Text style={styles.counterLabel}>POINTS FORTS</Text>
            <Text style={styles.counterValue}>{strengths.length}/2</Text>
          </View>
        </View>

        <View style={styles.dimensions}>
          {DIMENSIONS.map((item) => {
            const isStrength = strengths.includes(item.id);
            const isWeakness = weaknesses.includes(item.id);
            const isNeutral = !isStrength && !isWeakness;

            const strongDisabled =
              !isStrength && strengths.length >= 2;

            const weakDisabled =
              !isWeakness && weaknesses.length >= 2;

            return (
              <View
                key={item.id}
                style={[
                  styles.dimensionCard,
                  isStrength && styles.dimensionCardStrong,
                  isWeakness && styles.dimensionCardWeak,
                ]}
              >
                <View style={styles.dimensionMain}>
                  <Text style={styles.dimensionTitle}>{item.title}</Text>

                  <Text
                    style={[
                      styles.dimensionState,
                      isStrength && styles.dimensionStateStrong,
                      isWeakness && styles.dimensionStateWeak,
                    ]}
                  >
                    {isNeutral && 'NEUTRE · 3/5'}
                    {isStrength && 'POINT FORT · 4/5'}
                    {isWeakness && 'POINT FAIBLE · 2/5'}
                  </Text>
                </View>

                <View style={styles.actions}>
                  <Pressable
                    onPress={() => setDimensionState(item.id, 'weak')}
                    disabled={weakDisabled}
                    hitSlop={6}
                    style={({ pressed }) => [
                      styles.stateButton,
                      styles.stateButtonWeak,
                      isWeakness && styles.stateButtonWeakSelected,
                      weakDisabled && styles.stateButtonDisabled,
                      pressed && !weakDisabled && styles.stateButtonPressed,
                    ]}
                  >
                    <Ionicons
                      name="arrow-down"
                      size={17}
                      color={
                        isWeakness ? colors.brandWhite : colors.brandRed
                      }
                    />
                  </Pressable>

                  <Pressable
                    onPress={() => setDimensionState(item.id, 'strong')}
                    disabled={strongDisabled}
                    hitSlop={6}
                    style={({ pressed }) => [
                      styles.stateButton,
                      styles.stateButtonStrong,
                      isStrength && styles.stateButtonStrongSelected,
                      strongDisabled && styles.stateButtonDisabled,
                      pressed && !strongDisabled && styles.stateButtonPressed,
                    ]}
                  >
                    <Ionicons
                      name="arrow-up"
                      size={17}
                      color={
                        isStrength ? colors.brandWhite : colors.primaryLight
                      }
                    />
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>

        <View style={styles.legendCard}>
          <Text style={styles.legendText}>
            ↓ POINT FAIBLE
          </Text>

          <View style={styles.legendDot} />

          <Text style={styles.legendText}>
            NON SÉLECTIONNÉ = 3/5
          </Text>

          <View style={styles.legendDot} />

          <Text style={styles.legendText}>
            ↑ POINT FORT
          </Text>
        </View>

        <Pressable
          onPress={handleUnsure}
          style={({ pressed }) => [
            styles.unsureButton,
            unsure && styles.unsureButtonSelected,
            pressed && styles.stateButtonPressed,
          ]}
        >
          <View
            style={[
              styles.unsureStatus,
              unsure && styles.unsureStatusSelected,
            ]}
          >
            {unsure && (
              <Ionicons
                name="checkmark"
                size={17}
                color={colors.brandWhite}
              />
            )}
          </View>

          <View style={styles.unsureTextArea}>
            <Text
              style={[
                styles.unsureTitle,
                unsure && styles.unsureTitleSelected,
              ]}
            >
              JE NE SAIS PAS
            </Text>

            <Text style={styles.unsureText}>
              UGEROD démarre à 3/5 partout et apprendra avec mes séances.
            </Text>
          </View>
        </Pressable>

        <View style={styles.spacer} />

        <Pressable
          onPress={handleNext}
          disabled={!canContinue}
          style={({ pressed }) => [
            styles.primaryButton,
            !canContinue && styles.primaryButtonDisabled,
            pressed && canContinue && styles.primaryButtonPressed,
          ]}
        >
          <Text
            style={[
              styles.primaryButtonText,
              !canContinue && styles.primaryButtonTextDisabled,
            ]}
          >
            CONTINUER
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },

  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
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
    color: colors.textPrimary,
    fontSize: 40,
    lineHeight: 40,
    fontFamily: 'Oswald_400Regular',
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
    marginTop: spacing.sm,
    marginBottom: spacing.xxl,
  },

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

  progressFill: {
    width: '66.666%',
    height: '100%',
    backgroundColor: colors.primary,
  },

  titleArea: {
    marginBottom: spacing.lg,
  },

  title: {
    ...typography.display,
    color: colors.textPrimary,
    fontSize: 42,
    lineHeight: 46,
    letterSpacing: 2,
  },

  blueDot: {
    color: colors.primary,
  },

  subtitle: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    maxWidth: 390,
  },

  counterCard: {
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: 'rgba(17,21,26,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    marginBottom: spacing.md,
  },

  counterItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  counterDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },

  counterDotWeak: {
    backgroundColor: colors.brandRed,
  },

  counterDotStrong: {
    backgroundColor: colors.primary,
  },

  counterLabel: {
    flex: 1,
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.5,
    color: colors.textSecondary,
  },

  counterValue: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 19,
    lineHeight: 21,
    color: colors.textPrimary,
  },

  counterDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginHorizontal: 10,
  },

  dimensions: {
    gap: 10,
  },

  dimensionCard: {
    minHeight: 72,
    borderRadius: 16,
    backgroundColor: 'rgba(17,21,26,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  dimensionCardStrong: {
    borderColor: 'rgba(8,104,255,0.55)',
    backgroundColor: 'rgba(8,104,255,0.10)',
  },

  dimensionCardWeak: {
    borderColor: 'rgba(255,59,59,0.45)',
    backgroundColor: 'rgba(255,59,59,0.08)',
  },

  dimensionMain: {
    flex: 1,
  },

  dimensionTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 0.3,
    color: colors.textPrimary,
  },

  dimensionState: {
    fontFamily: 'Oswald_500Medium',
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.5,
    color: colors.textMuted,
    marginTop: 3,
  },

  dimensionStateStrong: {
    color: colors.primaryLight,
  },

  dimensionStateWeak: {
    color: colors.brandRed,
  },

  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  stateButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  stateButtonWeak: {
    backgroundColor: 'rgba(255,59,59,0.08)',
    borderColor: 'rgba(255,59,59,0.30)',
  },

  stateButtonWeakSelected: {
    backgroundColor: colors.brandRed,
    borderColor: colors.brandRed,
  },

  stateButtonStrong: {
    backgroundColor: 'rgba(8,104,255,0.10)',
    borderColor: 'rgba(8,104,255,0.28)',
  },

  stateButtonStrongSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  stateButtonDisabled: {
    opacity: 0.25,
  },

  stateButtonPressed: {
    transform: [{ scale: 0.94 }],
  },

  legendCard: {
    marginTop: 12,
    minHeight: 34,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },

  legendText: {
    fontFamily: 'Oswald_500Medium',
    fontSize: 8,
    lineHeight: 12,
    letterSpacing: 0.4,
    color: colors.textMuted,
  },

  legendDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.textMuted,
  },

  unsureButton: {
    minHeight: 78,
    marginTop: spacing.lg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    backgroundColor: 'rgba(17,21,26,0.92)',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  unsureButtonSelected: {
    borderColor: 'rgba(8,104,255,0.55)',
    backgroundColor: 'rgba(8,104,255,0.10)',
  },

  unsureStatus: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  unsureStatusSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  unsureTextArea: {
    flex: 1,
  },

  unsureTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 14,
    lineHeight: 18,
    color: colors.textPrimary,
  },

  unsureTitleSelected: {
    color: colors.primaryLight,
  },

  unsureText: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 16,
    color: colors.textSecondary,
    marginTop: 2,
  },

  spacer: {
    flex: 1,
    minHeight: spacing.xxl,
  },

  primaryButton: {
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.xxl,
  },

  primaryButtonDisabled: {
    backgroundColor: colors.surfaceElevated,
  },

  primaryButtonPressed: {
    backgroundColor: colors.primaryDark,
    transform: [{ scale: 0.985 }],
  },

  primaryButtonText: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 20,
    lineHeight: 23,
    letterSpacing: 1.2,
    color: colors.brandWhite,
  },

  primaryButtonTextDisabled: {
    color: colors.textDisabled,
  },

  pressed: {
    opacity: 0.65,
  },
});
