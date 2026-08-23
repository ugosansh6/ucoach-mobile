import { useCallback, useMemo, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
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
  spacing,
  typography,
  UGEROD_THEME_MODES,
} from '../../src/constants';
import { useUgerodTheme } from '../../src/contexts/UgerodThemeContext';
import { getCurrentProfile } from '../../src/services/profileService';
import { getCurrentPrimaryGoal } from '../../src/services/goalsService';
import { signOut } from '../../src/services/authService';
import { supabase } from '../../src/lib/supabase';

const backgroundImage = require('../../assets/backgrounds/welcome-default.jpg');
const brandIcon = require('../../assets/branding/ugerod-icon.png');

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

const THEME_OPTIONS = [
  {
    value: UGEROD_THEME_MODES.DARK,
    label: 'SOMBRE',
    icon: 'moon-outline',
  },
  {
    value: UGEROD_THEME_MODES.LIGHT,
    label: 'CLAIR',
    icon: 'sunny-outline',
  },
];

export default function ProfileScreen() {
  const { mode, colors, isDark, setThemeMode } = useUgerodTheme();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

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
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.loadingText}>CHARGEMENT DU PROFIL...</Text>
      </View>
    );
  }

  const profileContent = (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

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
            <Ionicons name="arrow-back" size={23} color={colors.text} />
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
              color={colors.secondaryAccentStrong}
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
              color={colors.accentStrong}
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
                color={colors.secondaryAccentStrong}
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
              color={colors.secondaryAccentStrong}
            />
          </Pressable>
        )}

        <SectionTitle title="PROFIL SPORTIF" styles={styles} />

        <View style={styles.settingsCard}>
          <ProfileRow
            icon="fitness-outline"
            label="EXPÉRIENCE"
            value={experienceLabel}
            onPress={() => router.push('/profile/level')}
            styles={styles}
            colors={colors}
          />
          <ProfileRow
            icon="flag-outline"
            label="OBJECTIF"
            value={goalLabel}
            onPress={() => router.push('/profile/goal')}
            styles={styles}
            colors={colors}
          />
          <ProfileRow
            icon="calendar-outline"
            label="RYTHME HEBDO"
            value={frequencyLabel}
            onPress={() => router.push('/profile/frequency')}
            styles={styles}
            colors={colors}
          />
          <ProfileRow
            icon="barbell-outline"
            label="MATÉRIEL"
            value="GÉRER MON INVENTAIRE"
            onPress={() => router.push('/profile/equipment')}
            styles={styles}
            colors={colors}
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
            styles={styles}
            colors={colors}
          />
        </View>

        <SectionTitle title="INFORMATIONS" styles={styles} />

        <View style={styles.settingsCard}>
          <SimpleRow
            icon="person-circle-outline"
            label="INFORMATIONS PERSONNELLES"
            subtitle={physicalSummary || 'Sexe, date de naissance, taille, poids'}
            value={!personalInfoComplete ? 'À COMPLÉTER' : null}
            valueTone={!personalInfoComplete ? 'warning' : 'default'}
            onPress={() => router.push('/profile/personal-information')}
            styles={styles}
            colors={colors}
          />
          <SimpleRow
            icon="lock-closed-outline"
            label="MOT DE PASSE"
            subtitle="Sécurité du compte"
            onPress={() => router.push('/profile/security')}
            styles={styles}
            colors={colors}
          />
          <SimpleRow
            icon="help-circle-outline"
            label="AIDE"
            subtitle="Questions et assistance"
            onPress={() => router.push('/profile/help')}
            last
            styles={styles}
            colors={colors}
          />
        </View>

        <SectionTitle title="PARAMÈTRES" styles={styles} />

        <View style={styles.settingsCard}>
          <ThemeSetting
            mode={mode}
            setThemeMode={setThemeMode}
            styles={styles}
            colors={colors}
          />
        </View>

        <SectionTitle title="COMPTE" styles={styles} />

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
            color={isDark ? colors.text : colors.secondaryAccentStrong}
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

  if (!isDark) {
    return profileContent;
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
          locations={[0, 0.22, 0.58, 1]}
          style={StyleSheet.absoluteFill}
        />

        <LinearGradient
          colors={[
            'rgba(7,9,12,0.46)',
            'rgba(7,9,12,0.05)',
            'rgba(7,9,12,0.30)',
          ]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />

        {profileContent}
      </ImageBackground>
    </View>
  );
}

function SectionTitle({ title, styles }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

function ProfileRow({
  icon,
  label,
  value,
  onPress,
  last = false,
  styles,
  colors,
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
        <Ionicons name={icon} size={21} color={colors.accentStrong} />
      </View>
      <View style={styles.rowMain}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue}>{value}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
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
  styles,
  colors,
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
        <Ionicons name={icon} size={21} color={colors.accentStrong} />
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
      <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
    </Pressable>
  );
}

function ThemeSetting({ mode, setThemeMode, styles, colors }) {
  return (
    <View style={styles.themeRow}>
      <View style={styles.rowIcon}>
        <Ionicons name="contrast-outline" size={21} color={colors.accentStrong} />
      </View>

      <View style={styles.themeMain}>
        <Text style={styles.rowLabel}>APPARENCE</Text>
        <Text style={styles.rowSubtitle}>
          Même interface, palette claire ou sombre.
        </Text>

        <View style={styles.themeSegmentedControl}>
          {THEME_OPTIONS.map((option) => {
            const selected = mode === option.value;

            return (
              <Pressable
                key={option.value}
                onPress={() => setThemeMode(option.value)}
                style={({ pressed }) => [
                  styles.themeSegment,
                  selected && styles.themeSegmentSelected,
                  pressed && styles.pressed,
                ]}
              >
                <Ionicons
                  name={option.icon}
                  size={18}
                  color={selected ? colors.textOnAccent : colors.textSecondary}
                />
                <Text
                  style={[
                    styles.themeSegmentText,
                    selected && styles.themeSegmentTextSelected,
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

function createStyles(colors, isDark) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    background: {
      flex: 1,
    },
    darkOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.30)',
    },
    safeArea: {
      flex: 1,
      backgroundColor: isDark ? 'transparent' : colors.background,
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
      backgroundColor: colors.background,
    },
    loadingText: {
      ...typography.body,
      fontSize: 16,
      lineHeight: 23,
      color: colors.textSecondary,
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
      backgroundColor: isDark ? 'rgba(17,21,26,0.90)' : colors.surface,
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255,255,255,0.10)' : colors.border,
    },
    headerTitle: {
      ...typography.screenTitle,
      fontSize: 32,
      lineHeight: 35,
      color: colors.text,
    },
    brandIcon: {
      width: 38,
      height: 38,
    },
    errorCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      borderRadius: 16,
      padding: spacing.md,
      marginBottom: spacing.md,
      backgroundColor: colors.errorSoft,
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255,107,107,0.25)' : colors.warningBorder,
    },
    errorText: {
      ...typography.body,
      flex: 1,
      fontSize: 16,
      lineHeight: 23,
      color: colors.secondaryAccentStrong,
    },
    identityCard: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: spacing.lg,
      borderRadius: 22,
      backgroundColor: isDark ? 'rgba(17,21,26,0.92)' : colors.surfaceElevated,
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255,255,255,0.09)' : colors.border,
      shadowColor: colors.shadow,
      shadowOpacity: isDark ? 0.18 : 0.06,
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
      backgroundColor: colors.accent,
    },
    avatarText: {
      ...typography.screenTitle,
      fontSize: 30,
      lineHeight: 33,
      color: colors.textOnAccent,
    },
    identityMain: {
      flex: 1,
      paddingHorizontal: spacing.md,
    },
    identityName: {
      ...typography.cardTitle,
      fontSize: 20,
      lineHeight: 26,
      color: colors.text,
    },
    identityEmail: {
      ...typography.body,
      marginTop: 3,
      fontSize: 15,
      lineHeight: 22,
      color: colors.textSecondary,
    },
    editButton: {
      width: 40,
      height: 40,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? 'rgba(8,104,255,0.10)' : colors.accentSoft,
    },
    completionCard: {
      marginTop: spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      padding: spacing.md,
      borderRadius: 18,
      backgroundColor: colors.warningSoft,
      borderWidth: 1,
      borderColor: colors.warningBorder,
    },
    completionIcon: {
      width: 42,
      height: 42,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.warningIconBackground,
    },
    completionMain: {
      flex: 1,
    },
    completionTitle: {
      ...typography.label,
      fontSize: 14,
      lineHeight: 19,
      color: colors.secondaryAccentStrong,
    },
    completionText: {
      ...typography.body,
      marginTop: 2,
      fontSize: 15,
      lineHeight: 22,
      color: colors.textSecondary,
    },
    sectionTitle: {
      ...typography.sectionTitle,
      marginTop: 30,
      marginBottom: 10,
      fontSize: 20,
      lineHeight: 26,
      color: colors.text,
    },
    settingsCard: {
      overflow: 'hidden',
      borderRadius: 20,
      backgroundColor: isDark ? 'rgba(17,21,26,0.92)' : colors.surfaceElevated,
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255,255,255,0.08)' : colors.border,
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
      backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : colors.surfacePressed,
    },
    rowBorder: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: isDark ? 'rgba(255,255,255,0.06)' : colors.border,
    },
    rowIcon: {
      width: 42,
      height: 42,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? 'rgba(8,104,255,0.10)' : colors.accentSoft,
    },
    rowMain: {
      flex: 1,
    },
    rowLabel: {
      ...typography.label,
      fontSize: 14,
      lineHeight: 19,
      color: colors.text,
    },
    rowValue: {
      ...typography.body,
      marginTop: 3,
      fontSize: 16,
      lineHeight: 23,
      color: colors.textSecondary,
    },
    rowSubtitle: {
      ...typography.body,
      marginTop: 3,
      fontSize: 15,
      lineHeight: 22,
      color: colors.textSecondary,
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
      color: colors.accentStrong,
      backgroundColor: colors.accentSoft,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
    },
    rowBadgeWarning: {
      color: colors.secondaryAccentStrong,
      backgroundColor: colors.secondaryAccentSoft,
    },
    themeRow: {
      minHeight: 126,
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingHorizontal: spacing.md,
      paddingVertical: 16,
      gap: 12,
    },
    themeMain: {
      flex: 1,
    },
    themeSegmentedControl: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 12,
    },
    themeSegment: {
      minHeight: 46,
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255,255,255,0.10)' : colors.borderStrong,
      backgroundColor: isDark ? 'rgba(17,21,26,0.90)' : colors.surface,
    },
    themeSegmentSelected: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    themeSegmentText: {
      ...typography.label,
      fontSize: 14,
      lineHeight: 19,
      color: colors.textSecondary,
    },
    themeSegmentTextSelected: {
      color: colors.textOnAccent,
    },
    logoutButton: {
      minHeight: 54,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255,255,255,0.09)' : colors.logoutBorder,
      backgroundColor: isDark ? 'rgba(17,21,26,0.92)' : colors.secondaryAccentSoft,
    },
    logoutButtonPressed: {
      backgroundColor: isDark ? 'rgba(25,30,36,0.96)' : colors.logoutPressed,
    },
    logoutText: {
      ...typography.button,
      fontSize: 18,
      lineHeight: 22,
      color: isDark ? colors.text : colors.secondaryAccentStrong,
    },
    versionArea: {
      marginTop: 34,
      alignItems: 'center',
      gap: 8,
    },
    versionLogo: {
      width: 30,
      height: 30,
      opacity: 0.72,
    },
    versionText: {
      ...typography.caption,
      fontSize: 13,
      lineHeight: 18,
      color: colors.textMuted,
    },
    cardPressed: {
      opacity: 0.82,
      transform: [{ scale: 0.995 }],
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
