import { router } from 'expo-router';
import { useState } from 'react';
import {
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

const backgroundImage = require('../../assets/backgrounds/welcome-default.jpg');
const brandIcon = require('../../assets/branding/ugerod-icon.png');

const PRECAUTIONS = [
  {
    id: 'none',
    title: 'AUCUNE',
    subtitle: 'Aucune gêne particulière à prendre en compte.',
    icon: 'checkmark-circle-outline',
  },
  {
    id: 'wrist',
    title: 'POIGNET',
    subtitle: 'Adapter les mouvements avec appui ou charge sur les poignets.',
    icon: 'hand-left-outline',
  },
  {
    id: 'elbow',
    title: 'COUDE',
    subtitle: 'Limiter les mouvements pouvant solliciter fortement le coude.',
    icon: 'body-outline',
  },
  {
    id: 'shoulder',
    title: 'ÉPAULE',
    subtitle: 'Adapter les mouvements au-dessus de la tête et les poussées.',
    icon: 'accessibility-outline',
  },
  {
    id: 'knee',
    title: 'GENOU',
    subtitle: 'Adapter les flexions, impacts et mouvements dynamiques.',
    icon: 'walk-outline',
  },
  {
    id: 'lower-back',
    title: 'BAS DU DOS',
    subtitle: 'Limiter les mouvements pouvant augmenter la contrainte lombaire.',
    icon: 'body-outline',
  },
];

export default function ProfilePrecautionsScreen() {
  /*
   * TEMPORAIRE AVANT SUPABASE
   *
   * Plus tard :
   * valeur initiale = profiles.default_injured_zones
   */
  const [selectedPrecautions, setSelectedPrecautions] = useState([
    'shoulder',
  ]);

  const [saved, setSaved] = useState(false);

  function handleBack() {
    router.back();
  }

  function handleSelectPrecaution(id) {
    setSaved(false);

    if (id === 'none') {
      setSelectedPrecautions(['none']);
      return;
    }

    setSelectedPrecautions((current) => {
      const withoutNone = current.filter(
        (item) => item !== 'none'
      );

      if (withoutNone.includes(id)) {
        const updated = withoutNone.filter(
          (item) => item !== id
        );

        return updated.length > 0
          ? updated
          : ['none'];
      }

      return [...withoutNone, id];
    });
  }

  function handleSave() {
    const valuesForSupabase =
      selectedPrecautions.includes('none')
        ? []
        : selectedPrecautions.map((id) => {
            const precaution = PRECAUTIONS.find(
              (item) => item.id === id
            );

            return precaution?.title;
          });

    console.log({
      selectedPrecautions,
      valuesForSupabase,
    });

    /*
     * PLUS TARD AVEC SUPABASE :
     *
     * await supabase
     *   .from('profiles')
     *   .update({
     *     default_injured_zones: valuesForSupabase,
     *   })
     *   .eq('id', user.id);
     */

    setSaved(true);

    setTimeout(() => {
      router.back();
    }, 450);
  }

  const visibleCount = selectedPrecautions.includes('none')
    ? 0
    : selectedPrecautions.length;

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
                  TES GÊNES
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
                À PRENDRE EN COMPTE
              </Text>

              <Text style={styles.introText}>
                Sélectionne les zones que UGEROD doit prendre en compte lors de la génération de tes séances.
              </Text>
            </View>

            {/* COMPTEUR */}
            <View style={styles.summaryCard}>
              <View>
                <Text style={styles.summaryEyebrow}>
                  ZONES SÉLECTIONNÉES
                </Text>

                <Text style={styles.summaryValue}>
                  {visibleCount}
                </Text>
              </View>

              <View style={styles.summaryIcon}>
                <Ionicons
                  name="medkit-outline"
                  size={24}
                  color={
                    visibleCount > 0
                      ? colors.brandRed
                      : colors.primaryLight
                  }
                />
              </View>
            </View>

            {/* OPTIONS */}
            <View style={styles.precautionList}>
              {PRECAUTIONS.map((item) => {
                const selected =
                  selectedPrecautions.includes(item.id);

                const isNone = item.id === 'none';

                return (
                  <Pressable
                    key={item.id}
                    onPress={() =>
                      handleSelectPrecaution(item.id)
                    }
                    style={({ pressed }) => [
                      styles.precautionCard,
                      selected &&
                        styles.precautionCardSelected,
                      selected &&
                        !isNone &&
                        styles.precautionCardAlert,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View
                      style={[
                        styles.precautionIcon,
                        selected &&
                          isNone &&
                          styles.precautionIconSelected,
                        selected &&
                          !isNone &&
                          styles.precautionIconAlert,
                      ]}
                    >
                      <Ionicons
                        name={item.icon}
                        size={22}
                        color={
                          selected
                            ? colors.brandWhite
                            : colors.textSecondary
                        }
                      />
                    </View>

                    <View style={styles.precautionMain}>
                      <Text
                        style={[
                          styles.precautionTitle,
                          selected &&
                            isNone &&
                            styles.precautionTitleSelected,
                          selected &&
                            !isNone &&
                            styles.precautionTitleAlert,
                        ]}
                      >
                        {item.title}
                      </Text>

                      <Text style={styles.precautionSubtitle}>
                        {item.subtitle}
                      </Text>
                    </View>

                    <View
                      style={[
                        styles.checkbox,
                        selected &&
                          isNone &&
                          styles.checkboxSelected,
                        selected &&
                          !isNone &&
                          styles.checkboxAlert,
                      ]}
                    >
                      {selected && (
                        <Ionicons
                          name="checkmark"
                          size={14}
                          color={colors.brandWhite}
                        />
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
                Ces informations servent à adapter les prochaines séances. Tu pourras aussi signaler une gêne différente juste avant chaque entraînement.
              </Text>
            </View>

            {/* WARNING */}
            {visibleCount > 0 && (
              <View style={styles.warningCard}>
                <Ionicons
                  name="alert-circle-outline"
                  size={21}
                  color={colors.brandRed}
                />

                <Text style={styles.warningText}>
                  UGEROD adapte l’entraînement, mais ne remplace pas l’avis d’un professionnel de santé.
                </Text>
              </View>
            )}

            {/* CTA */}
            <Pressable
              onPress={handleSave}
              style={({ pressed }) => [
                styles.saveButton,
                saved && styles.saveButtonDone,
                pressed &&
                  !saved &&
                  styles.saveButtonPressed,
              ]}
            >
              <Text style={styles.saveButtonText}>
                {saved
                  ? 'GÊNES ENREGISTRÉES'
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
            </Pressable>

            <Text style={styles.footerText}>
              Tu peux modifier ces informations à tout moment.
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
    maxWidth: 345,
  },

  /* SUMMARY */

  summaryCard: {
    minHeight: 96,
    marginTop: 24,
    borderRadius: 17,
    paddingHorizontal: 17,
    backgroundColor: 'rgba(17,21,26,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  summaryEyebrow: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.8,
    color: colors.textSecondary,
  },

  summaryValue: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 40,
    lineHeight: 42,
    color: colors.textPrimary,
    marginTop: 2,
  },

  summaryIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* PRECAUTIONS */

  precautionList: {
    marginTop: 18,
    gap: 10,
  },

  precautionCard: {
    minHeight: 92,
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

  precautionCardSelected: {
    backgroundColor: 'rgba(8,104,255,0.08)',
    borderColor: 'rgba(8,104,255,0.45)',
  },

  precautionCardAlert: {
    backgroundColor: 'rgba(255,59,59,0.05)',
    borderColor: 'rgba(255,59,59,0.32)',
  },

  precautionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  precautionIconSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  precautionIconAlert: {
    backgroundColor: colors.brandRed,
    borderColor: colors.brandRed,
  },

  precautionMain: {
    flex: 1,
  },

  precautionTitle: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 20,
    lineHeight: 23,
    letterSpacing: 0.9,
    color: colors.textPrimary,
  },

  precautionTitleSelected: {
    color: colors.primaryLight,
  },

  precautionTitleAlert: {
    color: colors.brandRed,
  },

  precautionSubtitle: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color: colors.textSecondary,
    marginTop: 2,
  },

  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },

  checkboxSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  checkboxAlert: {
    backgroundColor: colors.brandRed,
    borderColor: colors.brandRed,
  },

  /* INFO */

  infoCard: {
    minHeight: 82,
    marginTop: 24,
    borderRadius: 15,
    padding: 14,
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

  warningCard: {
    minHeight: 72,
    marginTop: 10,
    borderRadius: 15,
    padding: 14,
    backgroundColor: 'rgba(255,59,59,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,59,59,0.20)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  warningText: {
    flex: 1,
    fontFamily: 'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 16,
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
    height: 40,
  },

  pressed: {
    opacity: 0.65,
  },
});