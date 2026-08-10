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
  getCurrentProfile,
  updateWeeklySessionTarget,
} from '../../src/services/profileService';

const backgroundImage = require('../../assets/backgrounds/welcome-default.jpg');
const brandIcon = require('../../assets/branding/ugerod-icon.png');

const FREQUENCIES = [
  {
    id: 2,
    title: '2 SÉANCES',
    subtitle: 'Pour se relancer ou rester régulier.',
  },
  {
    id: 3,
    title: '3 SÉANCES',
    subtitle: 'Pour installer une routine solide.',
  },
  {
    id: 4,
    title: '4 SÉANCES',
    subtitle: 'Pour progresser efficacement.',
  },
  {
    id: 5,
    title: '5 SÉANCES',
    subtitle: 'Pour accélérer les progrès.',
  },
  {
    id: 6,
    title: '6 SÉANCES',
    subtitle: 'Pour s’entraîner intensément chaque jour.',
  },
];

export default function ProfileFrequencyScreen() {
  const [selectedFrequency, setSelectedFrequency] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    async function loadFrequency() {
      try {
        setIsLoading(true);
        setErrorMessage('');

        const profile = await getCurrentProfile();

        setSelectedFrequency(
          profile?.weekly_session_target ?? null
        );
      } catch (error) {
        console.log('PROFILE FREQUENCY LOAD ERROR', {
          message: error?.message,
          code: error?.code,
          details: error?.details,
        });

        setErrorMessage(
          error?.message ??
            'Impossible de charger ton rythme hebdomadaire.'
        );
      } finally {
        setIsLoading(false);
      }
    }

    loadFrequency();
  }, []);

  function handleBack() {
    if (isSaving) {
      return;
    }

    router.back();
  }

  function handleSelectFrequency(value) {
    if (isSaving) {
      return;
    }

    setSelectedFrequency(value);
    setSaved(false);
    setErrorMessage('');
  }

  async function handleSave() {
    if (!selectedFrequency || isSaving) {
      return;
    }

    try {
      setIsSaving(true);
      setSaved(false);
      setErrorMessage('');

      await updateWeeklySessionTarget(
        selectedFrequency
      );

      console.log(
        'PROFILE FREQUENCY — sauvegardé',
        selectedFrequency
      );

      setSaved(true);

      setTimeout(() => {
        router.back();
      }, 600);
    } catch (error) {
      console.log('PROFILE FREQUENCY SAVE ERROR', {
        message: error?.message,
        code: error?.code,
        details: error?.details,
        hint: error?.hint,
      });

      setErrorMessage(
        error?.message ??
          'Impossible d’enregistrer ton rythme hebdomadaire.'
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
          CHARGEMENT DE TON RYTHME...
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
                  TON RYTHME
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
                TON OBJECTIF HEBDOMADAIRE
              </Text>

              <Text style={styles.introText}>
                Choisis un rythme réaliste pour toi. UGEROD s’en sert comme cap pour organiser ta semaine, pas comme une contrainte.
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

            {/* SCORE */}
            <View style={styles.scoreCard}>
              <View style={styles.scoreLeft}>
                <Text style={styles.scoreEyebrow}>
                  OBJECTIF
                </Text>

                <View style={styles.scoreValueRow}>
                  <Text style={styles.scoreValue}>
                    {selectedFrequency}
                  </Text>

                  <Text style={styles.scoreUnit}>
                    SÉANCES
                  </Text>
                </View>
              </View>

              <View style={styles.scoreIcon}>
                <Ionicons
                  name="calendar-outline"
                  size={26}
                  color={colors.primaryLight}
                />
              </View>
            </View>

            {/* FREQUENCIES */}
            <View style={styles.frequencyList}>
              {FREQUENCIES.map((item) => {
                const selected =
                  selectedFrequency === item.id;

                return (
                  <Pressable
                    key={item.id}
                    onPress={() =>
                      handleSelectFrequency(item.id)
                    }
                    style={({ pressed }) => [
                      styles.frequencyCard,
                      selected &&
                        styles.frequencyCardSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View
                      style={[
                        styles.frequencyNumber,
                        selected &&
                          styles.frequencyNumberSelected,
                      ]}
                    >
                      <Text
                        style={[
                          styles.frequencyNumberText,
                          selected &&
                            styles.frequencyNumberTextSelected,
                        ]}
                      >
                        {item.id}
                      </Text>
                    </View>

                    <View style={styles.frequencyMain}>
                      <Text
                        style={[
                          styles.frequencyTitle,
                          selected &&
                            styles.frequencyTitleSelected,
                        ]}
                      >
                        {item.title}
                      </Text>

                      <Text style={styles.frequencySubtitle}>
                        {item.subtitle}
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
                name="information-circle-outline"
                size={21}
                color={colors.primaryLight}
              />

              <Text style={styles.infoText}>
                Si ta semaine change, aucun problème : ce nombre reste un objectif. UGEROD adapte les séances à ce que tu fais réellement.
              </Text>
            </View>

            {/* CTA */}
            <Pressable
              onPress={handleSave}
              disabled={
                !selectedFrequency ||
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
                  !selectedFrequency ||
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
                      ? 'RYTHME ENREGISTRÉ'
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
              Tu pourras modifier ton objectif hebdomadaire à tout moment.
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
    maxWidth: 330,
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

  /* SCORE */

  scoreCard: {
    minHeight: 104,
    marginTop: 24,
    borderRadius: 17,
    paddingHorizontal: 17,
    backgroundColor: 'rgba(17,21,26,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(8,104,255,0.25)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  scoreLeft: {
    flex: 1,
  },

  scoreEyebrow: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.8,
    color: colors.textSecondary,
  },

  scoreValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 7,
    marginTop: 2,
  },

  scoreValue: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 43,
    lineHeight: 45,
    color: colors.primaryLight,
  },

  scoreUnit: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 11,
    letterSpacing: 0.7,
    color: colors.textPrimary,
  },

  scoreIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(8,104,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(8,104,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* FREQUENCY */

  frequencyList: {
    marginTop: 18,
    gap: 10,
  },

  frequencyCard: {
    minHeight: 90,
    borderRadius: 17,
    paddingHorizontal: 14,
    paddingVertical: 13,
    backgroundColor: 'rgba(17,21,26,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  frequencyCardSelected: {
    backgroundColor: 'rgba(8,104,255,0.10)',
    borderColor: 'rgba(8,104,255,0.55)',
  },

  frequencyNumber: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  frequencyNumberSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  frequencyNumberText: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 25,
    lineHeight: 27,
    color: colors.textSecondary,
  },

  frequencyNumberTextSelected: {
    color: colors.brandWhite,
  },

  frequencyMain: {
    flex: 1,
  },

  frequencyTitle: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 20,
    lineHeight: 23,
    letterSpacing: 0.9,
    color: colors.textPrimary,
  },

  frequencyTitleSelected: {
    color: colors.primaryLight,
  },

  frequencySubtitle: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color: colors.textSecondary,
    marginTop: 2,
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
    minHeight: 78,
    marginTop: 24,
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