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

const FREQUENCIES = [
  { id: 2, subtitle: 'Pour se relancer ou rester régulier.' },
  { id: 3, subtitle: 'Pour installer une routine solide.' },
  { id: 4, subtitle: 'Pour progresser efficacement.' },
  { id: 5, subtitle: 'Pour accélérer les progrès.' },
  { id: 6, subtitle: 'Pour s’entraîner intensément chaque jour.' },
];

export default function FrequencyScreen() {
  const { weeklyTarget, setWeeklyTarget } = useOnboarding();

  function handleNext() {
    if (!weeklyTarget) return;
    router.push('/onboarding/athletic-profile');
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
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
          <Text style={styles.stepText}>ÉTAPE 3 SUR 6</Text>
          <View style={styles.progressTrack}>
            <View style={styles.progressFill} />
          </View>
        </View>

        <View style={styles.titleArea}>
          <Text style={styles.title}>
            TON RYTHME<Text style={styles.blueDot}>.</Text>
          </Text>
          <Text style={styles.subtitle}>
            Combien de séances veux-tu viser chaque semaine ?
          </Text>
        </View>

        <View style={styles.frequencyList}>
          {FREQUENCIES.map((item) => {
            const selected = weeklyTarget === item.id;

            return (
              <Pressable
                key={item.id}
                onPress={() => setWeeklyTarget(item.id)}
                style={({ pressed }) => [
                  styles.frequencyCard,
                  selected && styles.frequencyCardSelected,
                  pressed && styles.frequencyCardPressed,
                ]}
              >
                <View style={styles.frequencyMain}>
                  <View style={styles.frequencyTopRow}>
                    <Text
                      style={[
                        styles.frequencyNumber,
                        selected && styles.frequencyNumberSelected,
                      ]}
                    >
                      {item.id}
                    </Text>
                    <Text style={styles.frequencyLabel}>SÉANCES / SEMAINE</Text>
                  </View>
                  <Text style={styles.frequencySubtitle}>{item.subtitle}</Text>
                </View>

                <View style={[styles.radio, selected && styles.radioSelected]}>
                  {selected && <View style={styles.radioDot} />}
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>PAS DE JOURS IMPOSÉS</Text>
          <Text style={styles.infoText}>
            Ton objectif est hebdomadaire. Tu t’entraînes quand tu es disponible
            et UGEROD adapte la suite en fonction des séances déjà réalisées.
          </Text>
        </View>

        <View style={styles.spacer} />

        <Pressable
          onPress={handleNext}
          disabled={!weeklyTarget}
          style={({ pressed }) => [
            styles.primaryButton,
            !weeklyTarget && styles.primaryButtonDisabled,
            pressed && weeklyTarget && styles.primaryButtonPressed,
          ]}
        >
          <Text
            style={[
              styles.primaryButtonText,
              !weeklyTarget && styles.primaryButtonTextDisabled,
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
  progressFill: {
    width: '50%',
    height: '100%',
    backgroundColor: colors.primary,
  },
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
    maxWidth: 360,
  },
  frequencyList: { gap: spacing.md },
  frequencyCard: {
    minHeight: 98,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  frequencyCardSelected: {
    backgroundColor: colors.primaryTransparent,
    borderColor: colors.primary,
  },
  frequencyCardPressed: { transform: [{ scale: 0.99 }] },
  frequencyMain: { flex: 1, paddingRight: spacing.md },
  frequencyTopRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  frequencyNumber: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 32,
    lineHeight: 34,
    color: colors.textPrimary,
  },
  frequencyNumberSelected: { color: colors.primaryLight },
  frequencyLabel: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.8,
    color: colors.textSecondary,
  },
  frequencySubtitle: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
    marginTop: 4,
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
  radioSelected: { borderColor: colors.primary },
  radioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
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
  spacer: { flex: 1, minHeight: spacing.xxl },
  primaryButton: {
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.xxl,
  },
  primaryButtonDisabled: { backgroundColor: colors.surfaceElevated },
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
  primaryButtonTextDisabled: { color: colors.textDisabled },
  pressed: { opacity: 0.65 },
});
