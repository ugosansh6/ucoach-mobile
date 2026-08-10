import { router } from 'expo-router';
import { useState } from 'react';
import {
  Image,
  ImageBackground,
  Linking,
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

const FAQS = [
  {
    id: 'generation',
    question: 'COMMENT SONT GÉNÉRÉES LES SÉANCES ?',
    answer:
      'UGEROD utilise ton niveau, ton objectif, ton rythme, ta forme du jour, le temps disponible, ton matériel et les gênes signalées pour construire une séance adaptée.',
  },
  {
    id: 'equipment',
    question: 'PUIS-JE CHANGER MON MATÉRIEL À CHAQUE SÉANCE ?',
    answer:
      'Oui. Le matériel est renseigné avant chaque entraînement. Tu peux donc t’entraîner avec un équipement différent d’un jour à l’autre.',
  },
  {
    id: 'pain',
    question: 'QUE FAIRE SI J’AI UNE GÊNE OU UNE DOULEUR ?',
    answer:
      'Tu peux enregistrer des gênes habituelles dans ton profil et signaler une gêne différente avant une séance. UGEROD adaptera les mouvements proposés.',
  },
  {
    id: 'history',
    question: 'OÙ RETROUVER MES ANCIENNES SÉANCES ?',
    answer:
      'Tes séances réalisées sont accessibles depuis le Planning. Les jours avec une séance enregistrée sont identifiés dans le calendrier.',
  },
  {
    id: 'loads',
    question: 'EST-CE OBLIGATOIRE DE RENSEIGNER MES CHARGES ?',
    answer:
      'Non. Les charges sont optionnelles. Tu peux les renseigner après la séance uniquement pour les exercices compatibles avec un suivi de charge.',
  },
  {
    id: 'progression',
    question: 'COMMENT EST CALCULÉE MA PROGRESSION ?',
    answer:
      'La progression s’appuie notamment sur ta régularité, tes séances réalisées, ton ressenti, ton RPE et les performances enregistrées sur les exercices.',
  },
];

export default function HelpScreen() {
  const [openedFaq, setOpenedFaq] = useState(null);

  function handleBack() {
    router.back();
  }

  function toggleFaq(id) {
    setOpenedFaq((current) =>
      current === id ? null : id
    );
  }

  function handleContactSupport() {
    /*
     * TEMPORAIRE
     *
     * Remplacer plus tard par la vraie adresse support UGEROD.
     */
    Linking.openURL(
      'mailto:support@ugerod.app?subject=Aide%20UGEROD'
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
                  ASSISTANCE
                </Text>

                <Text style={styles.headerTitle}>
                  AIDE
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
                UNE QUESTION ?
              </Text>

              <Text style={styles.introText}>
                Retrouve ici les réponses aux questions principales sur l’utilisation de UGEROD.
              </Text>
            </View>

            {/* SUPPORT */}
            <View style={styles.supportCard}>
              <View style={styles.supportIcon}>
                <Ionicons
                  name="chatbubble-ellipses-outline"
                  size={24}
                  color={colors.primaryLight}
                />
              </View>

              <View style={styles.supportMain}>
                <Text style={styles.supportEyebrow}>
                  BESOIN D’AIDE ?
                </Text>

                <Text style={styles.supportTitle}>
                  CONTACTE LE SUPPORT
                </Text>

                <Text style={styles.supportText}>
                  Si tu ne trouves pas ta réponse ici, tu peux nous envoyer un message.
                </Text>
              </View>
            </View>

            <Pressable
              onPress={handleContactSupport}
              style={({ pressed }) => [
                styles.contactButton,
                pressed && styles.contactButtonPressed,
              ]}
            >
              <Ionicons
                name="mail-outline"
                size={19}
                color={colors.brandWhite}
              />

              <Text style={styles.contactButtonText}>
                CONTACTER LE SUPPORT
              </Text>
            </Pressable>

            {/* FAQ */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                QUESTIONS FRÉQUENTES
              </Text>

              <Text style={styles.sectionSubtitle}>
                Appuie sur une question pour afficher la réponse.
              </Text>

              <View style={styles.faqList}>
                {FAQS.map((faq) => {
                  const opened =
                    openedFaq === faq.id;

                  return (
                    <Pressable
                      key={faq.id}
                      onPress={() =>
                        toggleFaq(faq.id)
                      }
                      style={({ pressed }) => [
                        styles.faqCard,
                        opened &&
                          styles.faqCardOpened,
                        pressed && styles.pressed,
                      ]}
                    >
                      <View style={styles.faqHeader}>
                        <View
                          style={[
                            styles.faqIcon,
                            opened &&
                              styles.faqIconOpened,
                          ]}
                        >
                          <Ionicons
                            name="help-outline"
                            size={18}
                            color={
                              opened
                                ? colors.brandWhite
                                : colors.textSecondary
                            }
                          />
                        </View>

                        <Text style={styles.faqQuestion}>
                          {faq.question}
                        </Text>

                        <Ionicons
                          name={
                            opened
                              ? 'chevron-up'
                              : 'chevron-down'
                          }
                          size={19}
                          color={
                            opened
                              ? colors.primaryLight
                              : colors.textMuted
                          }
                        />
                      </View>

                      {opened && (
                        <View style={styles.faqAnswerArea}>
                          <Text style={styles.faqAnswer}>
                            {faq.answer}
                          </Text>
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* SÉCURITÉ / SANTÉ */}
            <View style={styles.healthCard}>
              <Ionicons
                name="medkit-outline"
                size={22}
                color={colors.brandRed}
              />

              <View style={styles.healthMain}>
                <Text style={styles.healthTitle}>
                  EN CAS DE DOULEUR
                </Text>

                <Text style={styles.healthText}>
                  Arrête l’exercice si une douleur apparaît. Les adaptations proposées par UGEROD ne remplacent pas l’avis d’un professionnel de santé.
                </Text>
              </View>
            </View>

            {/* VERSION */}
            <View style={styles.versionCard}>
              <View style={styles.versionLeft}>
                <Image
                  source={brandIcon}
                  style={styles.versionIcon}
                  resizeMode="contain"
                />

                <View>
                  <Text style={styles.versionTitle}>
                    UGEROD
                  </Text>

                  <Text style={styles.versionSubtitle}>
                    VERSION 1.0
                  </Text>
                </View>
              </View>

              <Ionicons
                name="checkmark-circle-outline"
                size={20}
                color={colors.textMuted}
              />
            </View>

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

  /* SUPPORT */

  supportCard: {
    minHeight: 116,
    marginTop: 25,
    borderRadius: 18,
    padding: 16,
    backgroundColor: 'rgba(8,104,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(8,104,255,0.25)',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 13,
  },

  supportIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(8,104,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  supportMain: {
    flex: 1,
  },

  supportEyebrow: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.8,
    color: colors.primaryLight,
  },

  supportTitle: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 22,
    lineHeight: 25,
    letterSpacing: 1,
    color: colors.textPrimary,
    marginTop: 2,
  },

  supportText: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color: colors.textSecondary,
    marginTop: 4,
  },

  contactButton: {
    minHeight: 54,
    marginTop: 10,
    borderRadius: 14,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },

  contactButtonPressed: {
    backgroundColor: colors.primaryDark,
    transform: [{ scale: 0.985 }],
  },

  contactButtonText: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 19,
    lineHeight: 22,
    letterSpacing: 1,
    color: colors.brandWhite,
  },

  /* FAQ */

  section: {
    marginTop: 29,
  },

  sectionTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 0.7,
    color: colors.textPrimary,
  },

  sectionSubtitle: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color: colors.textMuted,
    marginTop: 3,
  },

  faqList: {
    marginTop: 12,
    gap: 9,
  },

  faqCard: {
    borderRadius: 16,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(17,21,26,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
  },

  faqCardOpened: {
    borderColor: 'rgba(8,104,255,0.30)',
    backgroundColor: 'rgba(17,21,26,0.97)',
  },

  faqHeader: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },

  faqIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  faqIconOpened: {
    backgroundColor: colors.primary,
  },

  faqQuestion: {
    flex: 1,
    fontFamily: 'Oswald_700Bold',
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.3,
    color: colors.textPrimary,
  },

  faqAnswerArea: {
    paddingTop: 1,
    paddingBottom: 15,
    paddingLeft: 45,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
  },

  faqAnswer: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 18,
    color: colors.textSecondary,
    marginTop: 12,
  },

  /* HEALTH */

  healthCard: {
    minHeight: 94,
    marginTop: 22,
    borderRadius: 16,
    padding: 14,
    backgroundColor: 'rgba(255,59,59,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,59,59,0.20)',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
  },

  healthMain: {
    flex: 1,
  },

  healthTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.6,
    color: colors.brandRed,
  },

  healthText: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 16,
    color: colors.textSecondary,
    marginTop: 4,
  },

  /* VERSION */

  versionCard: {
    minHeight: 72,
    marginTop: 24,
    borderRadius: 16,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(17,21,26,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  versionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  versionIcon: {
    width: 38,
    height: 38,
  },

  versionTitle: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 20,
    lineHeight: 22,
    letterSpacing: 1,
    color: colors.textPrimary,
  },

  versionSubtitle: {
    fontFamily: 'Oswald_500Medium',
    fontSize: 8,
    lineHeight: 12,
    letterSpacing: 0.7,
    color: colors.textMuted,
  },

  bottomSpace: {
    height: 42,
  },

  pressed: {
    opacity: 0.65,
  },
});