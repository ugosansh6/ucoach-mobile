import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import {
  ActivityIndicator,
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
  spacing,
  typography,
  uxLightColors,
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

const brandIcon = require(
  '../../assets/branding/ugerod-icon.png'
);

const EXPERIENCE_LABELS = {
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

const GENDER_LABELS = {
  male: 'HOMME',
  female: 'FEMME',
  homme: 'HOMME',
  femme: 'FEMME',
};

export default function ProfileScreen() {
  const [profile, setProfile] = useState(null);
  const [goal, setGoal] = useState(null);
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  const loadProfile = useCallback(async () => {
    try {
      setIsLoading(true);
      setErrorMessage('');

      const [profileData, goalData, userResult] = await Promise.all([
        getCurrentProfile(),
        getCurrentPrimaryGoal(),
        supabase.auth.getUser(),
      ]);

      if (userResult.error) {
        throw userResult.error;
      }

      setProfile(profileData);
      setGoal(goalData);
      setEmail(userResult.data?.user?.email ?? '');
    } catch (error) {
      console.log('PROFILE LOAD ERROR', {
        message: error?.message,
        code: error?.code,
        details: error?.details,
      });

      setErrorMessage(
        error?.message ?? 'Impossible de charger ton profil.'
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadProfile();
    }, [loadProfile])
  );

  async function handleLogout() {
    try {
      await signOut();
      router.replace('/(auth)/welcome');
    } catch (error) {
      console.log('LOGOUT ERROR', {
        message: error?.message,
        code: error?.code,
      });

      setErrorMessage(
        error?.message ?? 'Impossible de te déconnecter.'
      );
    }
  }

  const firstName = profile?.firstname?.trim()
    ? profile.firstname.trim().toUpperCase()
    : 'UTILISATEUR';

  const initial = firstName.charAt(0) || 'U';

  const experienceLabel =
    EXPERIENCE_LABELS[profile?.experience] ?? 'NON RENSEIGNÉ';

  const goalLabel =
    GOAL_LABELS[goal?.name] ??
    goal?.name?.toUpperCase() ??
    'NON RENSEIGNÉ';

  const frequencyLabel = profile?.weekly_session_target
    ? `${profile.weekly_session_target} SÉANCES / SEMAINE`
    : 'NON RENSEIGNÉ';

  const precautions = Array.isArray(profile?.default_injured_zones)
    ? profile.default_injured_zones
    : [];

  const normalizedGender = String(profile?.gender ?? '')
    .trim()
    .toLowerCase();

  const genderLabel = GENDER_LABELS[normalizedGender] ?? null;
  const personalInfoComplete = Boolean(genderLabel);

  const physicalSummary = [
    genderLabel,
    profile?.height ? `${profile.height} CM` : null,
    profile?.weight ? `${profile.weight} KG` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  if (isLoading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color={uxLightColors.khaki} />
        <Text style={styles.loadingText}>CHARGEMENT DU PROFIL...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            style={({ pressed }) => [
              styles.headerButton,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons
              name="arrow-back"
              size={23}
              color={uxLightColors.text}
            />
          </Pressable>

          <Text style={styles.headerTitle}>PROFIL</Text>

          <Image
            source={brandIcon}
            style={styles.brandIcon}
            resizeMode="contain"
          />
        </View>

        {!!errorMessage && (
          <View style={styles.errorCard}>
            <Ionicons
              name="alert-circle-outline"
              size={22}
              color={uxLightColors.orange}
            />
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        )}

        <Pressable
          onPress={() => router.push('/profile/personal-information')}
          style={({ pressed }) => [
            styles.identityCard,
            pressed && styles.cardPressed,
          ]}
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>

          <View style={styles.identityMain}>
            <Text style={styles.identityName}>{firstName}</Text>
            <Text style={styles.identityEmail} numberOfLines={1}>
              {email || 'EMAIL NON DISPONIBLE'}
            </Text>
          </View>

          <View style={styles.editButton}>
            <Ionicons
              name="pencil-outline"
              size={19}
              color={uxLightColors.khakiDark}
            />
          </View>
        </Pressable>

        {!personalInfoComplete && (
          <Pressable
            onPress={() => router.push('/profile/personal-information')}
            style={({ pressed }) => [
              styles.completionCard,
              pressed && styles.cardPressed,
            ]}
          >
            <View style={styles.completionIcon}>
              <Ionicons
                name="person-add-outline"
                size={21}
                color={uxLightColors.orangeDark}
              />
            </View>
            <View style={styles.completionMain}>
              <Text style={styles.completionTitle}>PROFIL À COMPLÉTER</Text>
              <Text style={styles.completionText}>
                Renseigne ton sexe pour activer les repères de performance concernés.
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={21}
              color={uxLightColors.orangeDark}
            />
          </Pressable>
        )}

        <SectionTitle title="PROFIL SPORTIF" />

        <View style={styles.settingsCard}>
          <ProfileRow
            icon="fitness-outline"
            label="EXPÉRIENCE"
            value={experienceLabel}
            onPress={() => router.push('/profile/level')}
          />
          <ProfileRow
            icon="flag-outline"
            label="OBJECTIF"
            value={goalLabel}
            onPress={() => router.push('/profile/goal')}
          />
          <ProfileRow
            icon="calendar-outline"
            label="RYTHME HEBDO"
            value={frequencyLabel}
            onPress={() => router.push('/profile/frequency')}
          />
          <ProfileRow
            icon="barbell-outline"
            label="MATÉRIEL"
            value="GÉRER MON INVENTAIRE"
            onPress={() => router.push('/profile/equipment')}
          />
          <ProfileRow
            icon="medical-outline"
            label="GÊNES À PRENDRE EN COMPTE"
            value={
              precautions.length > 0
                ? precautions.map((item) => item.toUpperCase()).join(', ')
                : 'AUCUNE'
            }
            onPress={() => router.push('/profile/precautions')}
            last
          />
        </View>

        <SectionTitle title="INFORMATIONS" />

        <View style={styles.settingsCard}>
          <SimpleRow
            icon="person-circle-outline"
            label="INFORMATIONS PERSONNELLES"
            subtitle={
              physicalSummary || 'Sexe, date de naissance, taille, poids'
            }
            value={!personalInfoComplete ? 'À COMPLÉTER' : null}
            valueTone={!personalInfoComplete ? 'warning' : 'default'}
            onPress={() => router.push('/profile/personal-information')}
          />
          <SimpleRow
            icon="lock-closed-outline"
            label="MOT DE PASSE"
            subtitle="Sécurité du compte"
            onPress={() => router.push('/profile/security')}
          />
          <SimpleRow
            icon="help-circle-outline"
            label="AIDE"
            subtitle="Questions et assistance"
            onPress={() => router.push('/profile/help')}
            last
          />
        </View>

        <SectionTitle title="COMPTE" />

        <Pressable
          onPress={handleLogout}
          style={({ pressed }) => [
            styles.logoutButton,
            pressed && styles.logoutButtonPressed,
          ]}
        >
          <Ionicons
            name="log-out-outline"
            size={21}
            color={uxLightColors.orangeDark}
          />
          <Text style={styles.logoutText}>SE DÉCONNECTER</Text>
        </Pressable>

        <View style={styles.versionArea}>
          <Image
            source={brandIcon}
            style={styles.versionLogo}
            resizeMode="contain"
          />
          <Text style={styles.versionText}>UGEROD · VERSION 1.0</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionTitle({ title }) {
  return (
    <Text style={styles.sectionTitle}>{title}</Text>
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
        styles.row,
        !last && styles.rowBorder,
        pressed && styles.rowPressed,
      ]}
    >
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={21} color={uxLightColors.khakiDark} />
      </View>
      <View style={styles.rowMain}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue}>{value}</Text>
      </View>
      <Ionicons
        name="chevron-forward"
        size={20}
        color={uxLightColors.textMuted}
      />
    </Pressable>
  );
}

function SimpleRow({
  icon,
  label,
  subtitle,
  value,
  valueTone = 'default',
  onPress,
  last = false,
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !last && styles.rowBorder,
        pressed && styles.rowPressed,
      ]}
    >
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={21} color={uxLightColors.khakiDark} />
      </View>
      <View style={styles.rowMain}>
        <View style={styles.simpleRowTitleLine}>
          <Text style={styles.rowLabel}>{label}</Text>
          {!!value && (
            <Text
              style={[
                styles.rowBadge,
                valueTone === 'warning' && styles.rowBadgeWarning,
              ]}
            >
              {value}
            </Text>
          )}
        </View>
        <Text style={styles.rowSubtitle}>{subtitle}</Text>
      </View>
      <Ionicons
        name="chevron-forward"
        size={20}
        color={uxLightColors.textMuted}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: uxLightColors.background,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: 48,
  },
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: uxLightColors.background,
  },
  loadingText: {
    ...typography.body,
    fontSize: 16,
    lineHeight: 23,
    color: uxLightColors.textSecondary,
  },
  header: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  headerButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: uxLightColors.surface,
    borderWidth: 1,
    borderColor: uxLightColors.border,
  },
  headerTitle: {
    ...typography.screenTitle,
    fontSize: 32,
    lineHeight: 35,
    color: uxLightColors.text,
  },
  brandIcon: {
    width: 38,
    height: 38,
    tintColor: uxLightColors.khakiDark,
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: 16,
    padding: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: uxLightColors.orangeSoft,
    borderWidth: 1,
    borderColor: '#F0C6AA',
  },
  errorText: {
    ...typography.body,
    flex: 1,
    fontSize: 16,
    lineHeight: 23,
    color: uxLightColors.orangeDark,
  },
  identityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: 22,
    backgroundColor: uxLightColors.surfaceElevated,
    borderWidth: 1,
    borderColor: uxLightColors.border,
    shadowColor: '#000000',
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: uxLightColors.khaki,
  },
  avatarText: {
    ...typography.screenTitle,
    fontSize: 30,
    lineHeight: 33,
    color: uxLightColors.textOnAccent,
  },
  identityMain: {
    flex: 1,
    paddingHorizontal: spacing.md,
  },
  identityName: {
    ...typography.cardTitle,
    fontSize: 20,
    lineHeight: 26,
    color: uxLightColors.text,
  },
  identityEmail: {
    ...typography.body,
    marginTop: 3,
    fontSize: 15,
    lineHeight: 22,
    color: uxLightColors.textSecondary,
  },
  editButton: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: uxLightColors.khakiSoft,
  },
  completionCard: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 18,
    backgroundColor: uxLightColors.orangeSoft,
    borderWidth: 1,
    borderColor: '#F0C6AA',
  },
  completionIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF6EF',
  },
  completionMain: {
    flex: 1,
  },
  completionTitle: {
    ...typography.label,
    fontSize: 14,
    lineHeight: 19,
    color: uxLightColors.orangeDark,
  },
  completionText: {
    ...typography.body,
    marginTop: 2,
    fontSize: 15,
    lineHeight: 22,
    color: uxLightColors.textSecondary,
  },
  sectionTitle: {
    ...typography.sectionTitle,
    marginTop: 30,
    marginBottom: 10,
    fontSize: 20,
    lineHeight: 26,
    color: uxLightColors.text,
  },
  settingsCard: {
    overflow: 'hidden',
    borderRadius: 20,
    backgroundColor: uxLightColors.surfaceElevated,
    borderWidth: 1,
    borderColor: uxLightColors.border,
  },
  row: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    gap: 12,
  },
  rowPressed: {
    backgroundColor: uxLightColors.surfacePressed,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: uxLightColors.border,
  },
  rowIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: uxLightColors.khakiSoft,
  },
  rowMain: {
    flex: 1,
  },
  rowLabel: {
    ...typography.label,
    fontSize: 14,
    lineHeight: 19,
    color: uxLightColors.text,
  },
  rowValue: {
    ...typography.body,
    marginTop: 3,
    fontSize: 16,
    lineHeight: 23,
    color: uxLightColors.textSecondary,
  },
  rowSubtitle: {
    ...typography.body,
    marginTop: 3,
    fontSize: 15,
    lineHeight: 22,
    color: uxLightColors.textSecondary,
  },
  simpleRowTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  rowBadge: {
    ...typography.caption,
    fontSize: 12,
    lineHeight: 17,
    color: uxLightColors.khakiDark,
    backgroundColor: uxLightColors.khakiSoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  rowBadgeWarning: {
    color: uxLightColors.orangeDark,
    backgroundColor: uxLightColors.orangeSoft,
  },
  logoutButton: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E9B793',
    backgroundColor: uxLightColors.orangeSoft,
  },
  logoutButtonPressed: {
    backgroundColor: '#F8DDCA',
  },
  logoutText: {
    ...typography.button,
    fontSize: 18,
    lineHeight: 22,
    color: uxLightColors.orangeDark,
  },
  versionArea: {
    marginTop: 34,
    alignItems: 'center',
    gap: 8,
  },
  versionLogo: {
    width: 30,
    height: 30,
    tintColor: uxLightColors.textMuted,
    opacity: 0.72,
  },
  versionText: {
    ...typography.caption,
    fontSize: 13,
    lineHeight: 18,
    color: uxLightColors.textMuted,
  },
  cardPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.995 }],
  },
  pressed: {
    opacity: 0.7,
  },
});
