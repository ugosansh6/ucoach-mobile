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
import {
  colors,
  spacing,
  typography,
} from '../../src/constants';

const brandLogo = require('../../assets/branding/ugerod-logo-white.png');

const DIMENSIONS = [
  { id: 'strength', title: 'FORCE' },
  { id: 'cardio_endurance', title: 'CARDIO / ENDURANCE' },
  { id: 'bodyweight', title: 'POIDS DU CORPS / GYMNASTIQUE' },
  { id: 'explosiveness', title: 'EXPLOSIVITÉ' },
  { id: 'mobility', title: 'MOBILITÉ' },
];

function getDimensionState(id, strengths, weaknesses) {
  if (strengths.includes(id)) {
    return 'strong';
  }

  if (weaknesses.includes(id)) {
    return 'weak';
  }

  return 'neutral';
}

export default function AthleticProfileScreen() {
  const {
    startingProfile,
    setStartingProfile,
  } = useOnboarding();

  const strengths =
    startingProfile?.strengths ?? [];

  const weaknesses =
    startingProfile?.weaknesses ?? [];

  const unsure =
    startingProfile?.unsure ?? false;

  const canContinue =
    unsure ||
    strengths.length > 0 ||
    weaknesses.length > 0;

  function cycleDimension(id) {
    setStartingProfile((current) => {
      const currentStrengths =
        current?.strengths ?? [];

      const currentWeaknesses =
        current?.weaknesses ?? [];

      const currentState =
        getDimensionState(
          id,
          currentStrengths,
          currentWeaknesses
        );

      /*
       * 1er clic : point fort
       * 2e clic : point faible
       * 3e clic : retour neutre
       *
       * Maximum 2 points forts et 2 points faibles.
       */

      if (currentState === 'neutral') {
        if (currentStrengths.length < 2) {
          return {
            strengths: [
              ...currentStrengths,
              id,
            ],
            weaknesses:
              currentWeaknesses.filter(
                (item) => item !== id
              ),
            unsure: false,
          };
        }

        if (currentWeaknesses.length < 2) {
          return {
            strengths: currentStrengths,
            weaknesses: [
              ...currentWeaknesses,
              id,
            ],
            unsure: false,
          };
        }

        return current;
      }

      if (currentState === 'strong') {
        if (currentWeaknesses.length >= 2) {
          return current;
        }

        return {
          strengths:
            currentStrengths.filter(
              (item) => item !== id
            ),
          weaknesses: [
            ...currentWeaknesses,
            id,
          ],
          unsure: false,
        };
      }

      return {
        strengths:
          currentStrengths.filter(
            (item) => item !== id
          ),
        weaknesses:
          currentWeaknesses.filter(
            (item) => item !== id
          ),
        unsure: false,
      };
    });
  }

  function handleUnsure() {
    if (unsure) {
      setStartingProfile({
        strengths: [],
        weaknesses: [],
        unsure: false,
      });
      return;
    }

    setStartingProfile({
      strengths: [],
      weaknesses: [],
      unsure: true,
    });
  }

  function handleNext() {
    if (!canContinue) {
      return;
    }

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
            <Text style={styles.backIcon}>
              ‹
            </Text>
          </Pressable>

          <Image
            source={brandLogo}
            style={styles.logo}
            resizeMode="contain"
          />

          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.progressArea}>
          <Text style={styles.stepText}>
            ÉTAPE 4 SUR 6
          </Text>

          <View style={styles.progressTrack}>
            <View style={styles.progressFill} />
          </View>
        </View>

        <View style={styles.titleArea}>
          <Text style={styles.title}>
            TON PROFIL DE DÉPART
            <Text style={styles.blueDot}>
              .
            </Text>
          </Text>

          <Text style={styles.subtitle}>
            Choisis jusqu’à 2 points forts
            et 2 points faibles.
          </Text>
        </View>

        <View style={styles.legendRow}>
          <View
            style={[
              styles.legendBrick,
              styles.legendBrickStrong,
            ]}
          >
            <View style={styles.legendIconStrong}>
              <Ionicons
                name="thumbs-up-outline"
                size={18}
                color={colors.success}
              />
            </View>

            <View style={styles.legendTextArea}>
              <Text style={styles.legendLabel}>
                POINTS FORTS
              </Text>

              <Text
                style={[
                  styles.legendCount,
                  styles.legendCountStrong,
                ]}
              >
                {strengths.length}/2
              </Text>
            </View>
          </View>

          <View
            style={[
              styles.legendBrick,
              styles.legendBrickWeak,
            ]}
          >
            <View style={styles.legendIconWeak}>
              <Ionicons
                name="thumbs-down-outline"
                size={18}
                color={colors.brandRed}
              />
            </View>

            <View style={styles.legendTextArea}>
              <Text style={styles.legendLabel}>
                POINTS FAIBLES
              </Text>

              <Text
                style={[
                  styles.legendCount,
                  styles.legendCountWeak,
                ]}
              >
                {weaknesses.length}/2
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.dimensions}>
          {DIMENSIONS.map((item) => {
            const state =
              getDimensionState(
                item.id,
                strengths,
                weaknesses
              );

            const isStrong =
              state === 'strong';

            const isWeak =
              state === 'weak';

            return (
              <Pressable
                key={item.id}
                onPress={() =>
                  cycleDimension(item.id)
                }
                style={({ pressed }) => [
                  styles.dimensionButton,
                  isStrong &&
                    styles.dimensionButtonStrong,
                  isWeak &&
                    styles.dimensionButtonWeak,
                  pressed &&
                    styles.dimensionButtonPressed,
                ]}
              >
                <View
                  style={[
                    styles.stateIndicator,
                    isStrong &&
                      styles.stateIndicatorStrong,
                    isWeak &&
                      styles.stateIndicatorWeak,
                  ]}
                >
                  {isStrong && (
                    <Ionicons
                      name="arrow-up"
                      size={18}
                      color={colors.brandWhite}
                    />
                  )}

                  {isWeak && (
                    <Ionicons
                      name="arrow-down"
                      size={18}
                      color={colors.brandWhite}
                    />
                  )}

                  {!isStrong && !isWeak && (
                    <View
                      style={
                        styles.neutralIndicator
                      }
                    />
                  )}
                </View>

                <Text
                  style={[
                    styles.dimensionTitle,
                    isStrong &&
                      styles.dimensionTitleStrong,
                    isWeak &&
                      styles.dimensionTitleWeak,
                  ]}
                >
                  {item.title}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          onPress={handleUnsure}
          style={({ pressed }) => [
            styles.unsureButton,
            unsure &&
              styles.unsureButtonSelected,
            pressed &&
              styles.dimensionButtonPressed,
          ]}
        >
          <View
            style={[
              styles.unsureIcon,
              unsure &&
                styles.unsureIconSelected,
            ]}
          >
            <Ionicons
              name={
                unsure
                  ? 'checkmark'
                  : 'help'
              }
              size={18}
              color={
                unsure
                  ? colors.brandWhite
                  : colors.textSecondary
              }
            />
          </View>

          <Text
            style={[
              styles.unsureTitle,
              unsure &&
                styles.unsureTitleSelected,
            ]}
          >
            JE NE SAIS PAS
          </Text>
        </Pressable>

        <View style={styles.infoCard}>
          <Ionicons
            name="analytics-outline"
            size={18}
            color={colors.primaryLight}
          />

          <Text style={styles.infoText}>
            Tes futures séances et performances
            alimenteront progressivement ton profil sportif.
          </Text>
        </View>

        <Pressable
          onPress={handleNext}
          disabled={!canContinue}
          style={({ pressed }) => [
            styles.primaryButton,
            !canContinue &&
              styles.primaryButtonDisabled,
            pressed &&
              canContinue &&
              styles.primaryButtonPressed,
          ]}
        >
          <Text
            style={[
              styles.primaryButtonText,
              !canContinue &&
                styles.primaryButtonTextDisabled,
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
    paddingBottom: 24,
  },

  header: {
    minHeight: 78,
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
    height: 58,
    maxWidth: 180,
    alignSelf: 'center',
  },

  headerSpacer: {
    width: 44,
  },

  progressArea: {
    marginTop: 2,
    marginBottom: 18,
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
    marginBottom: 16,
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
    fontSize: 16,
    lineHeight: 23,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },

  legendRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },

  legendBrick: {
    flex: 1,
    minHeight: 76,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  legendBrickStrong: {
    backgroundColor: 'rgba(36,200,117,0.08)',
    borderColor: 'rgba(36,200,117,0.38)',
  },

  legendBrickWeak: {
    backgroundColor: 'rgba(255,59,59,0.08)',
    borderColor: 'rgba(255,59,59,0.38)',
  },

  legendIconStrong: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: 'rgba(36,200,117,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  legendIconWeak: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: 'rgba(255,59,59,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  legendTextArea: {
    flex: 1,
  },

  legendLabel: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.6,
    color: colors.textSecondary,
  },

  legendCount: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 24,
    lineHeight: 27,
    marginTop: 1,
  },

  legendCountStrong: {
    color: colors.success,
  },

  legendCountWeak: {
    color: colors.brandRed,
  },

  dimensions: {
    gap: 10,
  },

  dimensionButton: {
    minHeight: 76,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  dimensionButtonStrong: {
    backgroundColor: 'rgba(36,200,117,0.12)',
    borderColor: colors.success,
  },

  dimensionButtonWeak: {
    backgroundColor: 'rgba(255,59,59,0.11)',
    borderColor: colors.brandRed,
  },

  dimensionButtonPressed: {
    transform: [{ scale: 0.985 }],
    opacity: 0.9,
  },

  dimensionTitle: {
    flex: 1,
    fontFamily: 'Oswald_700Bold',
    fontSize: 16,
    lineHeight: 21,
    letterSpacing: 0.4,
    color: colors.textPrimary,
  },

  dimensionTitleStrong: {
    color: colors.success,
  },

  dimensionTitleWeak: {
    color: '#FF6B6B',
  },

  stateIndicator: {
    width: 36,
    height: 36,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  stateIndicatorStrong: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },

  stateIndicatorWeak: {
    backgroundColor: colors.brandRed,
    borderColor: colors.brandRed,
  },

  neutralIndicator: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.textMuted,
  },

  unsureButton: {
    minHeight: 76,
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },

  unsureButtonSelected: {
    backgroundColor: 'rgba(8,104,255,0.12)',
    borderColor: colors.primary,
  },

  unsureIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  unsureIconSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  unsureTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 0.4,
    color: colors.textPrimary,
  },

  unsureTitleSelected: {
    color: colors.primaryLight,
  },

  infoCard: {
    marginTop: 10,
    minHeight: 76,
    borderRadius: 14,
    backgroundColor: colors.backgroundSoft,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  infoText: {
    flex: 1,
    fontFamily: 'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
  },

  primaryButton: {
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingHorizontal: spacing.xl,
    marginTop: 18,
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