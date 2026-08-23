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
import { Ionicons } from '@expo/vector-icons';

import {
  colors,
  spacing,
  typography,
} from '../src/constants';

import { APP_ENV } from '../src/lib/supabase';

const brandIcon = require('../assets/branding/ugerod-icon.png');

const NORMALIZED_ENV = String(APP_ENV ?? 'development').toLowerCase();

const ENV_CONFIG = {
  development: {
    label: 'DEV',
    detail: 'Supabase DEV',
    color: '#2ECC71',
    backgroundColor: 'rgba(46,204,113,0.10)',
    borderColor: 'rgba(46,204,113,0.35)',
    icon: 'code-slash-outline',
  },
  staging: {
    label: 'STAGING',
    detail: 'Supabase STAGING',
    color: '#F5A623',
    backgroundColor: 'rgba(245,166,35,0.10)',
    borderColor: 'rgba(245,166,35,0.35)',
    icon: 'flask-outline',
  },
  production: {
    label: 'PRODUCTION',
    detail: 'Supabase PROD',
    color: '#FF4D4F',
    backgroundColor: 'rgba(255,77,79,0.10)',
    borderColor: 'rgba(255,77,79,0.35)',
    icon: 'warning-outline',
  },
};

const CURRENT_ENV =
  ENV_CONFIG[NORMALIZED_ENV] ??
  {
    label: NORMALIZED_ENV.toUpperCase(),
    detail: `Supabase ${NORMALIZED_ENV.toUpperCase()}`,
    color: '#A0A0A0',
    backgroundColor: 'rgba(160,160,160,0.10)',
    borderColor: 'rgba(160,160,160,0.35)',
    icon: 'help-circle-outline',
  };

const SECTIONS = [
  {
    title: 'AUTHENTIFICATION',
    icon: 'lock-closed-outline',
    pages: [
      {
        title: 'Bienvenue',
        subtitle: 'Écran d’entrée UGEROD',
        route: '/(auth)/welcome',
        icon: 'home-outline',
      },
      {
        title: 'Connexion',
        subtitle: 'Connexion utilisateur',
        route: '/(auth)/login',
        icon: 'log-in-outline',
      },
      {
        title: 'Créer un compte',
        subtitle: 'Inscription utilisateur',
        route: '/(auth)/register',
        icon: 'person-add-outline',
      },
      {
        title: 'Mot de passe oublié',
        subtitle: 'Demande de lien de réinitialisation',
        route: '/(auth)/forgot-password',
        icon: 'key-outline',
      },
      {
        title: 'Nouveau mot de passe',
        subtitle: 'Réinitialisation du mot de passe',
        route: '/(auth)/reset-password',
        icon: 'shield-checkmark-outline',
      },
      {
        title: 'Confirmation email',
        subtitle: 'Validation de l’adresse email',
        route: '/(auth)/email-confirmation',
        icon: 'mail-open-outline',
      },
    ],
  },

  {
    title: 'ONBOARDING',
    icon: 'flag-outline',
    pages: [
      {
        title: '1 · Niveau',
        subtitle: 'Choisir son niveau sportif',
        route: '/onboarding/level',
        icon: 'speedometer-outline',
      },
      {
        title: '2 · Objectif',
        subtitle: 'Définir son objectif principal',
        route: '/onboarding/goal',
        icon: 'trophy-outline',
      },
      {
        title: '3 · Rythme',
        subtitle: 'Nombre de séances par semaine',
        route: '/onboarding/frequency',
        icon: 'calendar-outline',
      },
      {
        title: '4 · Gênes',
        subtitle: 'Zones à prendre en compte',
        route: '/onboarding/precautions',
        icon: 'medkit-outline',
      },
      {
        title: '5 · Profil prêt',
        subtitle: 'Récapitulatif onboarding',
        route: '/onboarding/complete',
        icon: 'checkmark-circle-outline',
      },
    ],
  },

  {
    title: 'NAVIGATION PRINCIPALE',
    icon: 'apps-outline',
    pages: [
      {
        title: 'Dashboard · actuel',
        subtitle: 'Accueil principal actuel',
        route: '/(tabs)',
        icon: 'grid-outline',
      },
      {
        title: 'Dashboard · test sombre',
        subtitle: 'Nouvelle direction fitness home premium',
        route: '/dashboard-test',
        icon: 'moon-outline',
      },
      {
        title: 'Dashboard · test clair',
        subtitle: 'Kaki #646F5E · orange #FF6B19',
        route: '/dashboard-test-light',
        icon: 'sunny-outline',
      },
      {
        title: 'Planning',
        subtitle: 'Semaine, calendrier et historique',
        route: '/(tabs)/planning',
        icon: 'calendar-outline',
      },
      {
        title: 'Bibliothèque',
        subtitle: 'Catalogue des exercices',
        route: '/(tabs)/library',
        icon: 'barbell-outline',
      },
      {
        title: 'Progression',
        subtitle: 'Statistiques et évolution',
        route: '/(tabs)/progression',
        icon: 'analytics-outline',
      },
      {
        title: 'Profil',
        subtitle: 'Informations utilisateur',
        route: '/profile',
        icon: 'person-outline',
      },
    ],
  },

  {
    title: 'PROFIL & RÉGLAGES',
    icon: 'person-circle-outline',
    pages: [
      {
        title: 'Profil',
        subtitle: 'Vue principale du profil',
        route: '/profile',
        icon: 'person-outline',
      },
      {
        title: 'Niveau',
        subtitle: 'Modifier le niveau sportif',
        route: '/profile/level',
        icon: 'speedometer-outline',
      },
      {
        title: 'Objectif',
        subtitle: 'Modifier l’objectif principal',
        route: '/profile/goal',
        icon: 'trophy-outline',
      },
      {
        title: 'Rythme',
        subtitle: 'Objectif de séances par semaine',
        route: '/profile/frequency',
        icon: 'calendar-outline',
      },
      {
        title: 'Gênes',
        subtitle: 'Zones à prendre en compte',
        route: '/profile/precautions',
        icon: 'medkit-outline',
      },
      {
        title: 'Informations personnelles',
        subtitle: 'Données personnelles du compte',
        route: '/profile/personal-information',
        icon: 'id-card-outline',
      },
      {
        title: 'Sécurité',
        subtitle: 'Mot de passe et sécurité',
        route: '/profile/security',
        icon: 'shield-checkmark-outline',
      },
      {
        title: 'Aide',
        subtitle: 'Aide et support',
        route: '/profile/help',
        icon: 'help-circle-outline',
      },
    ],
  },

  {
    title: 'ENTRAÎNEMENT',
    icon: 'fitness-outline',
    pages: [
      {
        title: 'Préparer une séance',
        subtitle: 'Matériel, durée, forme et gêne',
        route: '/workout/preparation',
        icon: 'options-outline',
      },
      {
        title: 'Génération',
        subtitle: 'Création de la séance',
        route: '/workout/generating',
        icon: 'sparkles-outline',
      },
      {
        title: 'Séance active',
        subtitle: 'WOD complet et validation',
        route: '/workout/session',
        icon: 'flash-outline',
      },
      {
        title: 'Séance · pilote design',
        subtitle: 'Nouvelle direction éditoriale premium',
        route: '/workbench/session-design',
        icon: 'color-palette-outline',
      },
      {
        title: 'Fin de séance',
        subtitle: 'RPE, charges, notes et récap',
        route: '/workout/completion',
        icon: 'checkmark-done-outline',
      },
    ],
  },

  {
    title: 'DÉTAILS & HISTORIQUE',
    icon: 'time-outline',
    pages: [
      {
        title: 'Détail exercice',
        subtitle: 'Exemple : Goblet Squat',
        route: '/exercise/goblet-squat',
        icon: 'barbell-outline',
      },
      {
        title: 'Ancienne séance',
        subtitle: 'Récap d’une séance réalisée',
        route: '/workout/session-1',
        icon: 'document-text-outline',
      },
    ],
  },

  {
    title: 'TESTS BACKEND',
    icon: 'server-outline',
    pages: [
      {
        title: 'Test backend E2E',
        subtitle: 'Génération, persistence, swap, historique et progression',
        route: '/dev-backend-test',
        icon: 'flask-outline',
      },
    ],
  },

];

export default function DevMenuScreen() {
  function openPage(route) {
    router.push(route);
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {/* HEADER */}
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>
              MODE DÉVELOPPEMENT
            </Text>

            <Text style={styles.title}>
              UGEROD
              <Text style={styles.blueDot}>.</Text>
            </Text>

            <Text style={styles.subtitle}>
              Accès direct à tous les écrans de l’application.
            </Text>
          </View>

          <Image
            source={brandIcon}
            style={styles.brandIcon}
            resizeMode="contain"
          />
        </View>

        {/* ENVIRONMENT */}
        <View
          style={[
            styles.environmentCard,
            {
              backgroundColor: CURRENT_ENV.backgroundColor,
              borderColor: CURRENT_ENV.borderColor,
            },
          ]}
        >
          <View
            style={[
              styles.environmentIcon,
              {
                borderColor: CURRENT_ENV.borderColor,
              },
            ]}
          >
            <Ionicons
              name={CURRENT_ENV.icon}
              size={21}
              color={CURRENT_ENV.color}
            />
          </View>

          <View style={styles.environmentText}>
            <Text style={styles.environmentEyebrow}>
              ENVIRONNEMENT ACTIF
            </Text>

            <Text
              style={[
                styles.environmentTitle,
                {
                  color: CURRENT_ENV.color,
                },
              ]}
            >
              {CURRENT_ENV.label}
            </Text>

            <Text style={styles.environmentDescription}>
              {CURRENT_ENV.detail}
            </Text>
          </View>

          <View
            style={[
              styles.environmentDot,
              {
                backgroundColor: CURRENT_ENV.color,
              },
            ]}
          />
        </View>

        {/* WARNING DEV */}
        <View style={styles.devCard}>
          <View style={styles.devIcon}>
            <Ionicons
              name="construct-outline"
              size={20}
              color={colors.primaryLight}
            />
          </View>

          <View style={styles.devText}>
            <Text style={styles.devTitle}>
              MENU TEMPORAIRE
            </Text>

            <Text style={styles.devDescription}>
              Ce menu sert uniquement à tester rapidement les écrans pendant le développement.
            </Text>
          </View>
        </View>

        {/* SECTIONS */}
        {SECTIONS.map((section) => (
          <View
            key={section.title}
            style={styles.section}
          >
            <View style={styles.sectionHeader}>
              <Ionicons
                name={section.icon}
                size={17}
                color={colors.primaryLight}
              />

              <Text style={styles.sectionTitle}>
                {section.title}
              </Text>

              <View style={styles.sectionLine} />

              <Text style={styles.sectionCount}>
                {section.pages.length}
              </Text>
            </View>

            <View style={styles.pageList}>
              {section.pages.map((page, index) => (
                <Pressable
                  key={`${page.title}-${page.route}`}
                  onPress={() => openPage(page.route)}
                  style={({ pressed }) => [
                    styles.pageCard,
                    index !== section.pages.length - 1 &&
                      styles.pageCardBorder,
                    pressed && styles.pageCardPressed,
                  ]}
                >
                  <View style={styles.pageIcon}>
                    <Ionicons
                      name={page.icon}
                      size={20}
                      color={colors.textPrimary}
                    />
                  </View>

                  <View style={styles.pageText}>
                    <Text style={styles.pageTitle}>
                      {page.title}
                    </Text>

                    <Text style={styles.pageSubtitle}>
                      {page.subtitle}
                    </Text>
                  </View>

                  <Ionicons
                    name="chevron-forward"
                    size={20}
                    color={colors.textMuted}
                  />
                </Pressable>
              ))}
            </View>
          </View>
        ))}

        {/* FOOTER */}
        <View style={styles.footer}>
          <Image
            source={brandIcon}
            style={styles.footerIcon}
            resizeMode="contain"
          />

          <Text style={styles.footerTitle}>
            UGEROD
          </Text>

          <Text style={styles.footerText}>
            TON OBJECTIF · TA SÉANCE · TON ÉVOLUTION
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },

  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: 18,
    paddingBottom: 50,
  },

  /* HEADER */

  header: {
    minHeight: 100,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },

  headerText: {
    flex: 1,
  },

  eyebrow: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1.1,
    color: colors.primaryLight,
  },

  title: {
    ...typography.display,
    fontSize: 44,
    lineHeight: 47,
    letterSpacing: 2.4,
    color: colors.textPrimary,
    marginTop: 3,
  },

  blueDot: {
    color: colors.primary,
  },

  subtitle: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
    maxWidth: 280,
    marginTop: 4,
  },

  brandIcon: {
    width: 58,
    height: 58,
  },

  /* ENVIRONMENT */

  environmentCard: {
    minHeight: 92,
    marginTop: 12,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  environmentIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.03)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  environmentText: {
    flex: 1,
  },

  environmentEyebrow: {
    fontFamily: 'Oswald_600SemiBold',
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 0.8,
    color: colors.textMuted,
  },

  environmentTitle: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 28,
    lineHeight: 30,
    letterSpacing: 1.4,
    marginTop: 2,
  },

  environmentDescription: {
    fontFamily: 'Oswald_500Medium',
    fontSize: 10,
    lineHeight: 14,
    color: colors.textSecondary,
    marginTop: 1,
  },

  environmentDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },

  /* DEV CARD */

  devCard: {
    minHeight: 76,
    marginTop: 12,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 13,
    backgroundColor: 'rgba(8,104,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(8,104,255,0.25)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },

  devIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(8,104,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  devText: {
    flex: 1,
  },

  devTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.8,
    color: colors.primaryLight,
  },

  devDescription: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 16,
    color: colors.textSecondary,
    marginTop: 2,
  },

  /* SECTION */

  section: {
    marginTop: 28,
  },

  sectionHeader: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 9,
  },

  sectionTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.8,
    color: colors.textPrimary,
  },

  sectionLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },

  sectionCount: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 18,
    lineHeight: 20,
    color: colors.textMuted,
  },

  /* PAGE LIST */

  pageList: {
    borderRadius: 17,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },

  pageCard: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  pageCardBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },

  pageCardPressed: {
    opacity: 0.55,
  },

  pageIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.backgroundSoft,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  pageText: {
    flex: 1,
  },

  pageTitle: {
    fontFamily: 'Oswald_700Bold',
    fontSize: 13,
    lineHeight: 18,
    color: colors.textPrimary,
  },

  pageSubtitle: {
    fontFamily: 'Oswald_400Regular',
    fontSize: 10,
    lineHeight: 15,
    color: colors.textMuted,
    marginTop: 2,
  },

  /* FOOTER */

  footer: {
    marginTop: 36,
    paddingTop: 28,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
  },

  footerIcon: {
    width: 42,
    height: 42,
    marginBottom: 8,
  },

  footerTitle: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 24,
    lineHeight: 27,
    letterSpacing: 1.8,
    color: colors.textPrimary,
  },

  footerText: {
    fontFamily: 'Oswald_500Medium',
    fontSize: 8,
    lineHeight: 12,
    letterSpacing: 0.6,
    color: colors.textMuted,
    marginTop: 3,
  },
});