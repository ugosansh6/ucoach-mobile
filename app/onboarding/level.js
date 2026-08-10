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

import {
  colors,
  spacing,
  typography,
} from '../../src/constants';

const brandLogo = require('../../assets/branding/ugerod-logo-white.png');

const LEVELS = [
  {
    id: 'beginner',
    title: 'DÉBUTANT',
    description: 'Je débute ou je reprends après une longue pause.',
  },
  {
    id: 'intermediate',
    title: 'INTERMÉDIAIRE',
    description: 'Je m’entraîne régulièrement et je maîtrise les bases.',
  },
  {
    id: 'advanced',
    title: 'AVANCÉ',
    description: 'Je suis expérimenté et habitué aux entraînements intensifs.',
  },
];

export default function LevelScreen() {
  const { level, setLevel } = useOnboarding();

  const selectedLevel = level;
  const setSelectedLevel = setLevel;

  function handleBack() {
    router.back();
  }

  function handleNext() {
    if (!selectedLevel) return;

    router.push('/onboarding/goal');
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Pressable
            onPress={handleBack}
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
          <Text style={styles.stepText}>ÉTAPE 1 SUR 5</Text>

          <View style={styles.progressTrack}>
            <View style={styles.progressFill} />
          </View>
        </View>

        <View style={styles.titleArea}>
          <Text style={styles.title}>
            TON NIVEAU
            <Text style={styles.blueDot}>.</Text>
          </Text>

          <Text style={styles.subtitle}>
            Cela nous aide à adapter l’intensité et la difficulté de tes séances.
          </Text>
        </View>

        <View style={styles.cards}>
          {LEVELS.map((level) => {
            const selected = selectedLevel === level.id;

            return (
              <Pressable
                key={level.id}
                onPress={() => setSelectedLevel(level.id)}
                style={({ pressed }) => [
                  styles.card,
                  selected && styles.cardSelected,
                  pressed && styles.cardPressed,
                ]}
              >
                <View style={styles.cardContent}>
                  <View style={styles.cardTextArea}>
                    <Text
                      style={[
                        styles.cardTitle,
                        selected && styles.cardTitleSelected,
                      ]}
                    >
                      {level.title}
                    </Text>

                    <Text style={styles.cardDescription}>
                      {level.description}
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.radio,
                      selected && styles.radioSelected,
                    ]}
                  >
                    {selected && <View style={styles.radioDot} />}
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.spacer} />

        <Pressable
          onPress={handleNext}
          disabled={!selectedLevel}
          style={({ pressed }) => [
            styles.primaryButton,
            !selectedLevel && styles.primaryButtonDisabled,
            pressed &&
              selectedLevel &&
              styles.primaryButtonPressed,
          ]}
        >
          <Text
            style={[
              styles.primaryButtonText,
              !selectedLevel &&
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
    width: '20%',
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
    fontSize: 16,
    lineHeight: 23,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    maxWidth: 360,
  },

  cards: {
    gap: spacing.md,
  },

  card: {
    minHeight: 112,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },

  cardSelected: {
    backgroundColor: 'rgba(8, 104, 255, 0.10)',
    borderColor: colors.primary,
  },

  cardPressed: {
    transform: [{ scale: 0.99 }],
  },

  cardContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },

  cardTextArea: {
    flex: 1,
  },

  cardTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 18,
    lineHeight: 23,
    color: colors.textPrimary,
    letterSpacing: 0.5,
  },

  cardTitleSelected: {
    color: colors.primaryLight,
  },

  cardDescription: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
    marginTop: 5,
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