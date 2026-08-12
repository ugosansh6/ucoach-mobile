import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
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
import { Ionicons } from '@expo/vector-icons';

import {
  colors,
  spacing,
  typography,
} from '../../src/constants';

import {
  getCurrentProfile,
} from '../../src/services/profileService';

import {
  getCurrentPrimaryGoal,
} from '../../src/services/goalsService';

import {
  signOut,
} from '../../src/services/authService';

import { supabase } from '../../src/lib/supabase';

const backgroundImage = require(
  '../../assets/backgrounds/welcome-default.jpg'
);

const brandIcon = require(
  '../../assets/branding/ugerod-icon.png'
);

const LEVEL_LABELS = {
  beginner: 'DÉBUTANT',
  intermediate: 'INTERMÉDIAIRE',
  advanced: 'AVANCÉ',
};

const GOAL_LABELS = {
  'General Fitness': 'FORME GÉNÉRALE',
  'Fat Loss': 'PERTE DE GRAS',
  'Muscle Gain': 'PRISE DE MUSCLE',
  Strength: 'FORCE',
  Conditioning: 'CONDITIONING',
  Skill: 'SKILL',
};

export default function ProfileScreen() {
  const [profile, setProfile] = useState(null);
  const [goal, setGoal] = useState(null);
  const [email, setEmail] = useState('');

  const [isLoading, setIsLoading] =
    useState(true);

  const [errorMessage, setErrorMessage] =
    useState('');

  const loadProfile = useCallback(
    async () => {
      try {
        setIsLoading(true);
        setErrorMessage('');

        const [
          profileData,
          goalData,
          userResult,
        ] = await Promise.all([
          getCurrentProfile(),
          getCurrentPrimaryGoal(),
          supabase.auth.getUser(),
        ]);

        if (userResult.error) {
          throw userResult.error;
        }

        setProfile(profileData);
        setGoal(goalData);
        setEmail(
          userResult.data?.user?.email ?? ''
        );
      } catch (error) {
        console.log(
          'PROFILE LOAD ERROR',
          {
            message: error?.message,
            code: error?.code,
            details: error?.details,
          }
        );

        setErrorMessage(
          error?.message ??
            'Impossible de charger ton profil.'
        );
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  /*
   * Recharge le profil à chaque retour
   * sur cet écran.
   *
   * Important après modification du niveau,
   * objectif, fréquence, etc.
   */
  useFocusEffect(
    useCallback(() => {
      loadProfile();
    }, [loadProfile])
  );

  function handleBack() {
    router.back();
  }

  function handleEditIdentity() {
    router.push(
      '/profile/personal-information'
    );
  }

  function handleEditLevel() {
    router.push('/profile/level');
  }

  function handleEditGoal() {
    router.push('/profile/goal');
  }

  function handleEditFrequency() {
    router.push('/profile/frequency');
  }

  function handleEditEquipment() {
  router.push('/profile/equipment');
}

  function handleEditPrecautions() {
    router.push('/profile/precautions');
  }

  function handlePersonalInfo() {
    router.push(
      '/profile/personal-information'
    );
  }

  function handlePassword() {
    router.push('/profile/security');
  }

  function handleHelp() {
    router.push('/profile/help');
  }

  async function handleLogout() {
    try {
      await signOut();

      router.replace('/(auth)/welcome');
    } catch (error) {
      console.log(
        'LOGOUT ERROR',
        {
          message: error?.message,
          code: error?.code,
        }
      );

      setErrorMessage(
        error?.message ??
          'Impossible de te déconnecter.'
      );
    }
  }

  function handleDeleteAccount() {
    /*
     * On ne branche pas encore
     * la suppression réelle.
     *
     * Une suppression de compte devra
     * également nettoyer / anonymiser
     * les données liées.
     */
    console.log(
      'Suppression compte à implémenter'
    );
  }

  const firstName =
    profile?.firstname?.trim()
      ? profile.firstname.trim().toUpperCase()
      : 'UTILISATEUR';

  const initial =
    firstName.charAt(0) || 'U';

  const levelLabel =
    LEVEL_LABELS[profile?.experience] ??
    'NON RENSEIGNÉ';

  const goalLabel =
    GOAL_LABELS[goal?.name] ??
    goal?.name?.toUpperCase() ??
    'NON RENSEIGNÉ';

  const weeklyTarget =
    profile?.weekly_session_target;

  const frequencyLabel =
    weeklyTarget
      ? `${weeklyTarget} SÉANCES / SEMAINE`
      : 'NON RENSEIGNÉ';

  const precautions =
    Array.isArray(
      profile?.default_injured_zones
    )
      ? profile.default_injured_zones
      : [];

  if (isLoading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator
          size="large"
          color={colors.primary}
        />

        <Text style={styles.loadingText}>
          CHARGEMENT DU PROFIL...
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ImageBackground
        source={backgroundImage}
        style={styles.background}
        resizeMode="cover"
      >
        <View style={styles.darkOverlay} />

        <LinearGradient
          colors={[
            'rgba(7,9,12,0.42)',
            'rgba(7,9,12,0.60)',
            'rgba(7,9,12,0.88)',
            'rgba(7,9,12,0.99)',
          ]}
          locations={[
            0,
            0.22,
            0.58,
            1,
          ]}
          style={
            StyleSheet.absoluteFill
          }
        />

        <LinearGradient
          colors={[
            'rgba(7,9,12,0.46)',
            'rgba(7,9,12,0.05)',
            'rgba(7,9,12,0.30)',
          ]}
          start={{
            x: 0,
            y: 0.5,
          }}
          end={{
            x: 1,
            y: 0.5,
          }}
          style={
            StyleSheet.absoluteFill
          }
        />

        <SafeAreaView
          style={styles.safeArea}
        >
          <ScrollView
            contentContainerStyle={
              styles.content
            }
            showsVerticalScrollIndicator={
              false
            }
          >
            {/* HEADER */}
            <View style={styles.header}>
              <Pressable
                onPress={handleBack}
                hitSlop={12}
                style={({
                  pressed,
                }) => [
                  styles.backButton,
                  pressed &&
                    styles.pressed,
                ]}
              >
                <Ionicons
                  name="arrow-back"
                  size={22}
                  color={
                    colors.textPrimary
                  }
                />
              </Pressable>

              <View
                style={styles.headerText}
              >
                <Text
                  style={
                    styles.headerEyebrow
                  }
                >
                  TON COMPTE
                </Text>

                <Text
                  style={
                    styles.headerTitle
                  }
                >
                  PROFIL
                  <Text
                    style={
                      styles.blueDot
                    }
                  >
                    .
                  </Text>
                </Text>
              </View>

              <Image
                source={brandIcon}
                style={styles.brandIcon}
                resizeMode="contain"
              />
            </View>

            {/* ERREUR */}
            {!!errorMessage && (
              <View
                style={styles.errorCard}
              >
                <Ionicons
                  name="alert-circle-outline"
                  size={20}
                  color="#FF6B6B"
                />

                <View
                  style={
                    styles.errorMain
                  }
                >
                  <Text
                    style={
                      styles.errorTitle
                    }
                  >
                    ERREUR
                  </Text>

                  <Text
                    style={
                      styles.errorText
                    }
                  >
                    {errorMessage}
                  </Text>
                </View>
              </View>
            )}

            {/* IDENTITÉ */}
            <View
              style={styles.identityCard}
            >
              <View style={styles.avatar}>
                <Text
                  style={
                    styles.avatarText
                  }
                >
                  {initial}
                </Text>
              </View>

              <View
                style={
                  styles.identityMain
                }
              >
                <Text
                  style={
                    styles.identityName
                  }
                >
                  {firstName}
                </Text>

                <Text
                  style={
                    styles.identityEmail
                  }
                >
                  {email ||
                    'EMAIL NON DISPONIBLE'}
                </Text>
              </View>

              <Pressable
                onPress={
                  handleEditIdentity
                }
                style={({
                  pressed,
                }) => [
                  styles.editButton,
                  pressed &&
                    styles.pressed,
                ]}
              >
                <Ionicons
                  name="pencil-outline"
                  size={18}
                  color={
                    colors.primaryLight
                  }
                />
              </Pressable>
            </View>

            {/* PROFIL SPORTIF */}
            <View style={styles.section}>
              <Text
                style={
                  styles.sectionTitle
                }
              >
                TON PROFIL SPORTIF
              </Text>

              <View
                style={
                  styles.settingsCard
                }
              >
                <ProfileRow
                  icon="fitness-outline"
                  label="NIVEAU"
                  value={levelLabel}
                  onPress={
                    handleEditLevel
                  }
                />

                <ProfileRow
                  icon="flag-outline"
                  label="OBJECTIF"
                  value={goalLabel}
                  onPress={
                    handleEditGoal
                  }
                />

                <ProfileRow
                  icon="calendar-outline"
                  label="RYTHME HEBDO"
                  value={
                    frequencyLabel
                  }
                  onPress={
                    handleEditFrequency
                  }

                />
                <ProfileRow
                   icon="barbell-outline"
                   label="MON MATÉRIEL"
                   value="GÉRER MON INVENTAIRE"
                  onPress={
                  handleEditEquipment
                     }
                 />

                <ProfileRow
                  icon="medical-outline"
                  label="GÊNES À PRENDRE EN COMPTE"
                  value={
                    precautions.length >
                    0
                      ? precautions
                          .map(
                            (item) =>
                              item.toUpperCase()
                          )
                          .join(', ')
                      : 'AUCUNE'
                  }
                  onPress={
                    handleEditPrecautions
                  }
                  last
                />
              </View>
            </View>

            {/* ADAPTATION */}
            <View
              style={
                styles.adaptationCard
              }
            >
              <View
                style={
                  styles.adaptationIcon
                }
              >
                <Ionicons
                  name="flash-outline"
                  size={20}
                  color={
                    colors.primaryLight
                  }
                />
              </View>

              <View
                style={
                  styles.adaptationMain
                }
              >
                <Text
                  style={
                    styles.adaptationTitle
                  }
                >
                  TES SÉANCES S’ADAPTENT
                  AU JOUR J.
                </Text>

                <Text
                  style={
                    styles.adaptationText
                  }
                >
                  Ton matériel, ton temps
                  disponible et ta forme
                  sont renseignés avant
                  chaque entraînement.
                </Text>
              </View>
            </View>

            {/* INFORMATIONS */}
            <View style={styles.section}>
              <Text
                style={
                  styles.sectionTitle
                }
              >
                INFORMATIONS
              </Text>

              <View
                style={
                  styles.settingsCard
                }
              >
                <SimpleRow
                  icon="person-circle-outline"
                  label="INFORMATIONS PERSONNELLES"
                  subtitle="Âge, taille, poids..."
                  onPress={
                    handlePersonalInfo
                  }
                />

                <SimpleRow
                  icon="lock-closed-outline"
                  label="MOT DE PASSE"
                  subtitle="Sécurité du compte"
                  onPress={
                    handlePassword
                  }
                />

                <SimpleRow
                  icon="help-circle-outline"
                  label="AIDE"
                  subtitle="Questions et assistance"
                  onPress={handleHelp}
                  last
                />
              </View>
            </View>

            {/* COMPTE */}
            <View style={styles.section}>
              <Text
                style={
                  styles.sectionTitle
                }
              >
                COMPTE
              </Text>

              <Pressable
                onPress={handleLogout}
                style={({
                  pressed,
                }) => [
                  styles.logoutButton,
                  pressed &&
                    styles.logoutButtonPressed,
                ]}
              >
                <Ionicons
                  name="log-out-outline"
                  size={20}
                  color={
                    colors.textPrimary
                  }
                />

                <Text
                  style={
                    styles.logoutText
                  }
                >
                  SE DÉCONNECTER
                </Text>
              </Pressable>

              <Pressable
                onPress={
                  handleDeleteAccount
                }
                style={({
                  pressed,
                }) => [
                  styles.deleteButton,
                  pressed &&
                    styles.pressed,
                ]}
              >
                <Ionicons
                  name="trash-outline"
                  size={18}
                  color={
                    colors.brandRed
                  }
                />

                <Text
                  style={
                    styles.deleteText
                  }
                >
                  SUPPRIMER MON COMPTE
                </Text>
              </Pressable>
            </View>

            {/* VERSION */}
            <View
              style={styles.versionArea}
            >
              <Image
                source={brandIcon}
                style={
                  styles.versionLogo
                }
                resizeMode="contain"
              />

              <Text
                style={
                  styles.versionText
                }
              >
                UGEROD · VERSION 1.0
              </Text>
            </View>

            <View
              style={styles.bottomSpace}
            />
          </ScrollView>
        </SafeAreaView>
      </ImageBackground>
    </View>
  );
}

function ProfileRow({
  icon,
  label,
  value,
  onPress,
  last = false,
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.profileRow,
        !last &&
          styles.rowBorder,
        pressed &&
          styles.rowPressed,
      ]}
    >
      <View style={styles.rowIcon}>
        <Ionicons
          name={icon}
          size={19}
          color={
            colors.primaryLight
          }
        />
      </View>

      <View style={styles.rowMain}>
        <Text
          style={styles.rowLabel}
        >
          {label}
        </Text>

        <Text
          style={styles.rowValue}
        >
          {value}
        </Text>
      </View>

      <Ionicons
        name="chevron-forward"
        size={19}
        color={colors.textMuted}
      />
    </Pressable>
  );
}

function SimpleRow({
  icon,
  label,
  subtitle,
  onPress,
  last = false,
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.profileRow,
        !last &&
          styles.rowBorder,
        pressed &&
          styles.rowPressed,
      ]}
    >
      <View
        style={
          styles.rowIconNeutral
        }
      >
        <Ionicons
          name={icon}
          size={19}
          color={
            colors.textSecondary
          }
        />
      </View>

      <View style={styles.rowMain}>
        <Text
          style={
            styles.simpleRowLabel
          }
        >
          {label}
        </Text>

        <Text
          style={
            styles.simpleRowSubtitle
          }
        >
          {subtitle}
        </Text>
      </View>

      <Ionicons
        name="chevron-forward"
        size={19}
        color={colors.textMuted}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor:
      colors.background,
  },

  loadingScreen: {
    flex: 1,
    backgroundColor:
      colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },

  loadingText: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 11,
    letterSpacing: 0.8,
    color:
      colors.textSecondary,
  },

  background: {
    flex: 1,
  },

  safeArea: {
    flex: 1,
  },

  darkOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor:
      'rgba(0,0,0,0.30)',
  },

  content: {
    paddingHorizontal:
      spacing.xl,
    paddingTop: 8,
  },

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
    backgroundColor:
      'rgba(17,21,26,0.90)',
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  headerText: {
    flex: 1,
  },

  headerEyebrow: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1,
    color:
      colors.textSecondary,
  },

  headerTitle: {
    ...typography.display,
    fontSize: 32,
    lineHeight: 35,
    letterSpacing: 1.7,
    color:
      colors.textPrimary,
  },

  blueDot: {
    color: colors.primary,
  },

  brandIcon: {
    width: 46,
    height: 46,
  },

  errorCard: {
    minHeight: 58,
    marginTop: 8,
    borderRadius: 14,
    padding: 12,
    backgroundColor:
      'rgba(255,107,107,0.08)',
    borderWidth: 1,
    borderColor:
      'rgba(255,107,107,0.25)',
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },

  errorMain: {
    flex: 1,
  },

  errorTitle: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 10,
    color: '#FF6B6B',
  },

  errorText: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 11,
    color:
      colors.textSecondary,
    marginTop: 2,
  },

  identityCard: {
    minHeight: 104,
    marginTop: 8,
    borderRadius: 18,
    padding: 16,
    backgroundColor:
      'rgba(17,21,26,0.92)',
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.09)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },

  avatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor:
      colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  avatarText: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 30,
    lineHeight: 32,
    color:
      colors.brandWhite,
  },

  identityMain: {
    flex: 1,
  },

  identityName: {
    fontFamily:
      'BebasNeue_400Regular',
    fontSize: 27,
    lineHeight: 30,
    letterSpacing: 1.1,
    color:
      colors.textPrimary,
  },

  identityEmail: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 12,
    lineHeight: 17,
    color:
      colors.textSecondary,
    marginTop: 2,
  },

  editButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor:
      'rgba(8,104,255,0.10)',
    borderWidth: 1,
    borderColor:
      'rgba(8,104,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  section: {
    marginTop: 28,
  },

  sectionTitle: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 0.7,
    color:
      colors.textPrimary,
    marginBottom: 10,
  },

  settingsCard: {
    borderRadius: 17,
    backgroundColor:
      'rgba(17,21,26,0.92)',
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },

  profileRow: {
    minHeight: 76,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor:
      'rgba(255,255,255,0.06)',
  },

  rowPressed: {
    backgroundColor:
      'rgba(255,255,255,0.03)',
  },

  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor:
      'rgba(8,104,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  rowIconNeutral: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor:
      'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  rowMain: {
    flex: 1,
  },

  rowLabel: {
    fontFamily:
      'Oswald_600SemiBold',
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.7,
    color:
      colors.textMuted,
  },

  rowValue: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.3,
    color:
      colors.textPrimary,
    marginTop: 3,
  },

  simpleRowLabel: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.3,
    color:
      colors.textPrimary,
  },

  simpleRowSubtitle: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 16,
    color:
      colors.textMuted,
    marginTop: 2,
  },

  adaptationCard: {
    minHeight: 92,
    marginTop: 14,
    borderRadius: 16,
    padding: 14,
    backgroundColor:
      'rgba(8,104,255,0.08)',
    borderWidth: 1,
    borderColor:
      'rgba(8,104,255,0.23)',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
  },

  adaptationIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor:
      'rgba(8,104,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  adaptationMain: {
    flex: 1,
  },

  adaptationTitle: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.5,
    color:
      colors.textPrimary,
  },

  adaptationText: {
    fontFamily:
      'Oswald_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color:
      colors.textSecondary,
    marginTop: 4,
  },

  logoutButton: {
    minHeight: 56,
    borderRadius: 14,
    backgroundColor:
      'rgba(17,21,26,0.92)',
    borderWidth: 1,
    borderColor:
      'rgba(255,255,255,0.09)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },

  logoutButtonPressed: {
    backgroundColor:
      'rgba(25,30,36,0.96)',
    transform: [
      {
        scale: 0.99,
      },
    ],
  },

  logoutText: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.7,
    color:
      colors.textPrimary,
  },

  deleteButton: {
    minHeight: 52,
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor:
      'rgba(255,59,59,0.22)',
    backgroundColor:
      'rgba(255,59,59,0.05)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },

  deleteText: {
    fontFamily:
      'Oswald_700Bold',
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.7,
    color:
      colors.brandRed,
  },

  versionArea: {
    marginTop: 36,
    alignItems: 'center',
  },

  versionLogo: {
    width: 38,
    height: 38,
    opacity: 0.7,
  },

  versionText: {
    fontFamily:
      'Oswald_500Medium',
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.8,
    color:
      colors.textMuted,
    marginTop: 7,
  },

  bottomSpace: {
    height: 40,
  },

  pressed: {
    opacity: 0.65,
  },
});