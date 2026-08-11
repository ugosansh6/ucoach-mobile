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

const PRECAUTIONS = [
  { id: 'Aucune', title: 'AUCUNE' },
  { id: 'Poignet', title: 'POIGNET' },
  { id: 'Coude', title: 'COUDE' },
  { id: 'Épaule', title: 'ÉPAULE' },
  { id: 'Genou', title: 'GENOU' },
  { id: 'Bas du dos', title: 'BAS DU DOS' },
];

export default function PrecautionsScreen() {
  const { precautions, setPrecautions } = useOnboarding();

  function togglePrecaution(id) {
    if (id === 'Aucune') {
      setPrecautions(['Aucune']);
      return;
    }

    setPrecautions((current) => {
      const withoutNone = current.filter((item) => item !== 'Aucune');

      if (withoutNone.includes(id)) {
        return withoutNone.filter((item) => item !== id);
      }

      return [...withoutNone, id];
    });
  }

  function handleNext() {
    if (precautions.length === 0) return;
    router.push('/onboarding/complete');
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
          <Text style={styles.stepText}>ÉTAPE 5 SUR 6</Text>
          <View style={styles.progressTrack}>
            <View style={styles.progressFill} />
          </View>
        </View>

        <View style={styles.titleArea}>
          <Text style={styles.title}>
            GÊNES À PRENDRE{`\n`}EN COMPTE<Text style={styles.blueDot}>.</Text>
          </Text>
          <Text style={styles.subtitle}>
            Indique les zones que UGEROD doit prendre en compte lors de la
            construction de tes séances.
          </Text>
        </View>

        <View style={styles.grid}>
          {PRECAUTIONS.map((item) => {
            const selected = precautions.includes(item.id);

            return (
              <Pressable
                key={item.id}
                onPress={() => togglePrecaution(item.id)}
                style={({ pressed }) => [
                  styles.option,
                  selected && styles.optionSelected,
                  pressed && styles.optionPressed,
                ]}
              >
                <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
                  {selected && <Text style={styles.checkmark}>✓</Text>}
                </View>
                <Text
                  style={[
                    styles.optionTitle,
                    selected && styles.optionTitleSelected,
                  ]}
                >
                  {item.title}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>TU POURRAS MODIFIER ÇA PLUS TARD</Text>
          <Text style={styles.infoText}>
            Et avant chaque séance, tu pourras également signaler une gêne ou
            une blessure du jour.
          </Text>
        </View>

        <View style={styles.spacer} />

        <Pressable
          onPress={handleNext}
          disabled={precautions.length === 0}
          style={({ pressed }) => [
            styles.primaryButton,
            precautions.length === 0 && styles.primaryButtonDisabled,
            pressed && precautions.length > 0 && styles.primaryButtonPressed,
          ]}
        >
          <Text
            style={[
              styles.primaryButtonText,
              precautions.length === 0 && styles.primaryButtonTextDisabled,
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
    width: '83.333%',
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
    maxWidth: 380,
  },
  grid: { gap: spacing.md },
  option: {
    minHeight: 72,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  optionSelected: {
    backgroundColor: colors.primaryTransparent,
    borderColor: colors.primary,
  },
  optionPressed: { transform: [{ scale: 0.99 }] },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkmark: {
    color: colors.brandWhite,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 17,
  },
  optionTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: 0.5,
    color: colors.textPrimary,
  },
  optionTitleSelected: { color: colors.primaryLight },
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
