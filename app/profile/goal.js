import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import {
  colors,
  spacing,
  typography,
} from '../../src/constants';

import {
  getCurrentPrimaryGoal,
  savePrimaryGoal,
} from '../../src/services/goalsService';

const backgroundImage = require('../../assets/backgrounds/welcome-default.jpg');
const brandIcon = require('../../assets/branding/ugerod-icon.png');

const GOALS = [
  {
    id: 'General Fitness',
    title: 'ÊTRE EN FORME',
    subtitle: 'Entretenir une condition physique complète et durable.',
    icon: 'fitness-outline',
  },
  {
    id: 'Fat Loss',
    title: 'PERDRE DU GRAS',
    subtitle: 'Augmenter ma dépense énergétique et améliorer ma condition physique.',
    icon: 'flame-outline',
  },
  {
    id: 'Muscle Gain',
    title: 'PRENDRE DU MUSCLE',
    subtitle: 'Développer progressivement ma masse musculaire.',
    icon: 'barbell-outline',
  },
  {
    id: 'Strength',
    title: 'GAGNER EN FORCE',
    subtitle: 'Développer ma force sur les mouvements principaux.',
    icon: 'barbell-outline',
  },
  {
    id: 'Conditioning',
    title: 'AMÉLIORER MON ENDURANCE',
    subtitle: 'Développer mon cardio, mon endurance et ma capacité à maintenir l’effort.',
    icon: 'speedometer-outline',
  },
];

export default function ProfileGoalScreen() {
  const [selectedGoal, setSelectedGoal] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    async function loadGoal() {
      try {
        setIsLoading(true);
        setErrorMessage('');

        const currentGoal = await getCurrentPrimaryGoal();

        setSelectedGoal(
          currentGoal?.name ?? null
        );
      } catch (error) {
        console.log('PROFILE GOAL LOAD ERROR', {
          message: error?.message,
          code: error?.code,
          details: error?.details,
        });

        setErrorMessage(
          error?.message ??
            'Impossible de charger ton objectif.'
        );
      } finally {
        setIsLoading(false);
      }
    }

    loadGoal();
  }, []);

  function handleBack() {
    if (isSaving) {
      return;
    }

    router.back();
  }

  function handleSelectGoal(goalId) {
    if (isSaving) {
      return;
    }

    setSelectedGoal(goalId);
    setSaved(false);
    setErrorMessage('');
  }

  async function handleSave() {
    if (!selectedGoal || isSaving) {
      return;
    }

    try {
      setIsSaving(true);
      setSaved(false);
      setErrorMessage('');

      await savePrimaryGoal(selectedGoal);

      console.log(
        'PROFILE GOAL — sauvegardé',
        selectedGoal
      );

      setSaved(true);

      setTimeout(() => {
        router.back();
      }, 600);
    } catch (error) {
      console.log('PROFILE GOAL SAVE ERROR', {
        message: error?.message,
        code: error?.code,
        details: error?.details,
        hint: error?.hint,
      });

      setErrorMessage(
        error?.message ??
          'Impossible d’enregistrer ton objectif.'
      );
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator
          size="large"
          color={colors.primary}
        />

        <Text style={styles.loadingText}>
          CHARGEMENT DE TON OBJECTIF...
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ImageBackground
        source={backgroundImage}
        resizeMode="cover"
        style={styles.background}
      >
        <View style={styles.darkOverlay} />

        <LinearGradient
          colors={[
            'rgba(7,9,12,0.45)',
            'rgba(7,9,12,0.72)',
            'rgba(7,9,12,0.95)',
            'rgba(7,9,12,1)',
          ]}
          locations={[0, 0.26, 0.68, 1]}
          style={StyleSheet.absoluteFill}
        />

        <SafeAreaView style={styles.safeArea}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
          >
            {/* HEADER */}
            <View style={styles.header}>
              <Pressable
                onPress={handleBack}
                hitSlop={12}
                style={({ pressed }) => [
                  styles.backButton,
                  pressed && styles.pressed,
                ]}
              >
                <Ionicons
                  name="arrow-back"
                  size={22}
                  color={colors.textPrimary}
                />
              </Pressable>

              <View style={styles.headerText}>
                <Text style={styles.headerEyebrow}>
                  PROFIL SPORTIF
                </Text>

                <Text style={styles.headerTitle}>
                  TON OBJECTIF
                  <Text style={styles.blueDot}>.</Text>
                </Text>
              </View>

              <Image
                source={brandIcon}
                style={styles.brandIcon}
                resizeMode="contain"
              />
            </View>

            {/* INTRO */}
            <View style={styles.intro}>
              <Text style={styles.introTitle}>
                CE QUE TU VEUX ATTEINDRE
              </Text>

              <Text style={styles.introText}>
                UGEROD utilisera cet objectif pour orienter le contenu et l’intensité de tes séances.
              </Text>
            </View>

            {!!errorMessage && (
              <View style={styles.errorCard}>
                <Ionicons
                  name="alert-circle-outline"
                  size={20}
                  color="#FF6B6B"
                />

                <Text style={styles.errorText}>
                  {errorMessage}
                </Text>
              </View>
            )}

            {/* OBJECTIFS */}
            <View style={styles.goalList}>
              {GOALS.map((goal) => {
                const selected =
                  selectedGoal === goal.id;

                return (
                  <Pressable
                    key={goal.id}
                    onPress={() =>
                      handleSelectGoal(goal.id)
                    }
                    style={({ pressed }) => [
                      styles.goalCard,
                      selected &&
                        styles.goalCardSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View
                      style={[
                        styles.goalIcon,
                        selected &&
                          styles.goalIconSelected,
                      ]}
                    >
                      <Ionicons
                        name={goal.icon}
                        size={23}
                        color={
                          selected
                            ? colors.brandWhite
                            : colors.textSecondary
                        }
                      />
                    </View>

                    <View style={styles.goalMain}>
                      <Text
                        style={[
                          styles.goalTitle,
                          selected &&
                            styles.goalTitleSelected,
                        ]}
                      >
                        {goal.title}
                      </Text>

                      <Text style={styles.goalSubtitle}>
                        {goal.subtitle}
                      </Text>
                    </View>

                    <View
                      style={[
                        styles.radioOuter,
                        selected &&
                          styles.radioOuterSelected,
                      ]}
                    >
                      {selected && (
                        <View style={styles.radioInner} />
                      )}
                    </View>
                  </Pressable>
                );
              })}
            </View>

            {/* INFO */}
            <View style={styles.infoCard}>
              <Ionicons
                name="sync-outline"
                size={21}
                color={colors.primaryLight}
              />

              <Text style={styles.infoText}>
                Changer ton objectif ne supprime pas ton historique. UGEROD adaptera simplement les prochaines séances.
              </Text>
            </View>

            {/* CTA */}
            <Pressable
              onPress={handleSave}
              disabled={
                !selectedGoal ||
                isSaving ||
                saved
              }
              style={({ pressed }) => [
                styles.saveButton,
                saved && styles.saveButtonDone,
                pressed &&
                  !saved &&
                  !isSaving &&
                  styles.saveButtonPressed,
                (
                  !selectedGoal ||
                  isSaving
                ) &&
                  styles.saveButtonDisabled,
              ]}
            >
              {isSaving ? (
                <>
                  <ActivityIndicator
                    size="small"
                    color={colors.brandWhite}
                  />

                  <Text style={styles.saveButtonText}>
                    ENREGISTREMENT...
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.saveButtonText}>
                    {saved
                      ? 'OBJECTIF ENREGISTRÉ'
                      : 'ENREGISTRER'}
                  </Text>

                  <Ionicons
                    name={
                      saved
                        ? 'checkmark-circle'
                        : 'checkmark-circle-outline'
                    }
                    size={21}
                    color={colors.brandWhite}
                  />
                </>
              )}
            </Pressable>

            <Text style={styles.footerText}>
              Tu pourras modifier ton objectif à tout moment.
            </Text>

            <View style={styles.bottomSpace} />
          </ScrollView>
        </SafeAreaView>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },

  loadingScreen: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },

  loadingText: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 11,
    letterSpacing: 0.8,
    color: colors.textSecondary,
  },

  background: {
    flex: 1,
  },

  safeArea: {
    flex: 1,
  },

  darkOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.30)',
  },

  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: 8,
  },

  /* HEADER */

  header: {
    minHeight: 74,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(17,21,26,0.90)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  headerText: {
    flex: 1,
  },

  headerEyebrow: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1,
    color: colors.textSecondary,
  },

  headerTitle: {
    ...typography.display,
    fontSize: 32,
    lineHeight: 35,
    letterSpacing: 1.7,
    color: colors.textPrimary,
  },

  blueDot: {
    color: colors.primary,
  },

  brandIcon: {
    width: 45,
    height: 45,
  },

  /* INTRO */

  intro: {
    marginTop: 25,
  },

  introTitle: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 31,
    lineHeight: 34,
    letterSpacing: 1.4,
    color: colors.textPrimary,
  },

  introText: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color: colors.textSecondary,
    marginTop: 6,
    maxWidth: 340,
  },

  errorCard: {
    minHeight: 58,
    marginTop: 18,
    borderRadius: 14,
    padding: 12,
    backgroundColor: 'rgba(255,107,107,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,107,107,0.25)',
    flexDirection: 'row',
    gap: 9,
    alignItems: 'center',
  },

  errorText: {
    flex: 1,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color: colors.textSecondary,
  },

  /* GOALS */

  goalList: {
    marginTop: 25,
    gap: 11,
  },

  goalCard: {
    minHeight: 104,
    borderRadius: 17,
    paddingHorizontal: 15,
    paddingVertical: 14,
    backgroundColor: 'rgba(17,21,26,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },

  goalCardSelected: {
    backgroundColor: 'rgba(8,104,255,0.10)',
    borderColor: 'rgba(8,104,255,0.55)',
  },

  goalIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  goalIconSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  goalMain: {
    flex: 1,
  },

  goalTitle: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 20,
    lineHeight: 23,
    letterSpacing: 0.8,
    color: colors.textPrimary,
  },

  goalTitleSelected: {
    color: colors.primaryLight,
  },

  goalSubtitle: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color: colors.textSecondary,
    marginTop: 3,
  },

  radioOuter: {
    width: 23,
    height: 23,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },

  radioOuterSelected: {
    borderColor: colors.primaryLight,
  },

  radioInner: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: colors.primary,
  },

  /* INFO */

  infoCard: {
    minHeight: 76,
    marginTop: 25,
    borderRadius: 15,
    paddingHorizontal: 14,
    paddingVertical: 13,
    backgroundColor: 'rgba(8,104,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(8,104,255,0.25)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  infoText: {
    flex: 1,
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color: colors.textSecondary,
  },

  /* CTA */

  saveButton: {
    minHeight: 56,
    marginTop: 23,
    borderRadius: 14,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },

  saveButtonDone: {
    backgroundColor: colors.primaryDark,
  },

  saveButtonPressed: {
    backgroundColor: colors.primaryDark,
    transform: [{ scale: 0.985 }],
  },

  saveButtonDisabled: {
    opacity: 0.65,
  },

  saveButtonText: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 20,
    lineHeight: 23,
    letterSpacing: 1.1,
    color: colors.brandWhite,
  },

  footerText: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 16,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 10,
  },

  bottomSpace: {
    height: 38,
  },

  pressed: {
    opacity: 0.65,
  },
});