import { router } from 'expo-router';
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

  function toggleStrength(id) {
    setStartingProfile((current) => {
      const currentStrengths = current?.strengths ?? [];
      const currentWeaknesses = current?.weaknesses ?? [];
      const alreadySelected = currentStrengths.includes(id);

      if (!alreadySelected && currentStrengths.length >= 2) {
        return current;
      }

      return {
        strengths: alreadySelected
          ? currentStrengths.filter((item) => item !== id)
          : [...currentStrengths, id],
        weaknesses: currentWeaknesses.filter((item) => item !== id),
        unsure: false,
      };
    });
  }

  function toggleWeakness(id) {
    setStartingProfile((current) => {
      const currentStrengths = current?.strengths ?? [];
      const currentWeaknesses = current?.weaknesses ?? [];
      const alreadySelected = currentWeaknesses.includes(id);

      if (!alreadySelected && currentWeaknesses.length >= 2) {
        return current;
      }

      return {
        strengths: currentStrengths.filter((item) => item !== id),
        weaknesses: alreadySelected
          ? currentWeaknesses.filter((item) => item !== id)
          : [...currentWeaknesses, id],
        unsure: false,
      };
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
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <Text style={styles.backIcon}>‹</Text>
          </Pressable>

          <Image source={brandLogo} style={styles.logo} resizeMode="contain" />
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
            Choisis jusqu’à 2 points forts et 2 points faibles. UGEROD part de
            3/5 partout, passe tes points forts à 4/5 et tes points faibles à
            2/5. Tes performances réelles prendront ensuite le relais.
          </Text>
        </View>

        <SelectionSection
          title="TES POINTS FORTS"
          helper={`${strengths.length}/2 sélectionné${strengths.length > 1 ? 's' : ''}`}
          selected={strengths}
          blocked={strengths.length >= 2}
          onToggle={toggleStrength}
          tone="strong"
        />

        <SelectionSection
          title="TES POINTS FAIBLES"
          helper={`${weaknesses.length}/2 sélectionné${weaknesses.length > 1 ? 's' : ''}`}
          selected={weaknesses}
          blocked={weaknesses.length >= 2}
          onToggle={toggleWeakness}
          tone="weak"
        />

        <Pressable
          onPress={handleUnsure}
          style={({ pressed }) => [
            styles.unsureButton,
            unsure && styles.unsureButtonSelected,
            pressed && styles.cardPressed,
          ]}
        >
          <View style={[styles.radio, unsure && styles.radioSelected]}>
            {unsure && <View style={styles.radioDot} />}
          </View>
          <View style={styles.unsureTextArea}>
            <Text style={[styles.unsureTitle, unsure && styles.unsureTitleSelected]}>
              JE NE SAIS PAS
            </Text>
            <Text style={styles.unsureText}>
              UGEROD démarre à 3/5 partout et apprendra avec mes séances.
            </Text>
          </View>
        </Pressable>

        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>UNE ESTIMATION, PAS UNE ÉTIQUETTE</Text>
          <Text style={styles.infoText}>
            Cette étape sert uniquement au démarrage. Les résultats observés
            par UGEROD auront toujours plus de poids que cette déclaration.
          </Text>
        </View>

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

function SelectionSection({
  title,
  helper,
  selected,
  blocked,
  onToggle,
  tone,
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionHelper}>{helper}</Text>
      </View>

      <View style={styles.options}>
        {DIMENSIONS.map((item) => {
          const isSelected = selected.includes(item.id);
          const isDisabled = blocked && !isSelected;

          return (
            <Pressable
              key={`${tone}-${item.id}`}
              disabled={isDisabled}
              onPress={() => onToggle(item.id)}
              style={({ pressed }) => [
                styles.option,
                isSelected &&
                  (tone === 'strong'
                    ? styles.optionStrongSelected
                    : styles.optionWeakSelected),
                isDisabled && styles.optionDisabled,
                pressed && !isDisabled && styles.cardPressed,
              ]}
            >
              <View
                style={[
                  styles.checkbox,
                  isSelected &&
                    (tone === 'strong'
                      ? styles.checkboxStrongSelected
                      : styles.checkboxWeakSelected),
                ]}
              >
                {isSelected && <Text style={styles.checkmark}>✓</Text>}
              </View>

              <Text
                style={[
                  styles.optionTitle,
                  isSelected &&
                    (tone === 'strong'
                      ? styles.optionStrongText
                      : styles.optionWeakText),
                ]}
              >
                {item.title}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
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
    marginBottom: spacing.xxl,
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
  section: {
    marginBottom: spacing.xxl,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  sectionTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 16,
    lineHeight: 21,
    letterSpacing: 0.7,
    color: colors.textPrimary,
  },
  sectionHelper: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 12,
    color: colors.textSecondary,
  },
  options: {
    gap: spacing.sm,
  },
  option: {
    minHeight: 62,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  optionStrongSelected: {
    backgroundColor: colors.primaryTransparent,
    borderColor: colors.primary,
  },
  optionWeakSelected: {
    backgroundColor: colors.errorTransparent,
    borderColor: colors.error,
  },
  optionDisabled: {
    opacity: 0.38,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxStrongSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkboxWeakSelected: {
    backgroundColor: colors.error,
    borderColor: colors.error,
  },
  checkmark: {
    color: colors.brandWhite,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 17,
  },
  optionTitle: {
    flex: 1,
    fontFamily: 'Oswald_700Bold',
    fontSize: 16,
    lineHeight: 21,
    color: colors.textPrimary,
    letterSpacing: 0.35,
  },
  optionStrongText: {
    color: colors.primaryLight,
  },
  optionWeakText: {
    color: colors.error,
  },
  unsureButton: {
    minHeight: 82,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundSoft,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  unsureButtonSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryTransparent,
  },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: colors.primary,
  },
  radioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
  },
  unsureTextArea: {
    flex: 1,
  },
  unsureTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 16,
    color: colors.textPrimary,
  },
  unsureTitleSelected: {
    color: colors.primaryLight,
  },
  unsureText: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
    marginTop: 3,
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
    letterSpacing: 0.7,
    color: colors.textPrimary,
  },
  infoText: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSecondary,
    marginTop: spacing.xs,
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
  cardPressed: {
    transform: [{ scale: 0.99 }],
  },
  pressed: {
    opacity: 0.65,
  },
});
